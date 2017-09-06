//============================================================================
// Distributed under the Apache License, Version 2.0.
// Author: Raphael Menges (raphaelmenges@uni-koblenz.de)
//============================================================================

#include "FutureCoordinateAction.h"
#include "src/State/Web/Tab/Interface/TabInteractionInterface.h"
#include "submodules/glm/glm/gtx/vector_angle.hpp"
#include <algorithm>

// Deviation weight function
const std::function<float(float)> DEVIATION_WEIGHT = [](float dev) { return 3.f * dev; };

// Dimming duration
const float DIMMING_DURATION = 0.5f; // seconds until it is dimmed

// Dimming value
const float DIMMING_VALUE = 0.0f; // no dimming for experiment

// Deviation fading duration (how many seconds until full deviation is back to zero)
const float DEVIATION_FADING_DURATION = 0.5f;

// Multiplier of movement towards center (one means that on maximum zoom the outermost corner is moved into center)
const float CENTER_OFFSET_MULTIPLIER = 0.f; // TODO integrate in drift offset calculation 0.1f;

// Duration to replace current coordinate with input
const float MOVE_DURATION = 1.0f;

// Maximum zoom level
const float MAX_ZOOM = 0.3f;

// Maximum linear zoom duration
const float ZOOM_DURATION = 1.75f;

// Steepnes of zooming
const float ZOOM_STEEPNESS = 1.25f;

// Name of custom transformation
const std::string TRANS_NAME = "FutureCoordinateAction";

FutureCoordinateAction::FutureCoordinateAction(TabInteractionInterface* pTab, bool doDimming) : Action(pTab)
{
	// Save members
	_doDimming = doDimming;

    // Add in- and output data slots
    AddVec2OutputSlot("coordinate");
}

bool FutureCoordinateAction::Update(float tpf, const std::shared_ptr<const TabInput> spInput)
{
	// ####################
	// ### DECLARATIONS ###
	// ####################

	// Speed of zooming
	float zoomSpeed = 0.f;

	// Web view resolution
	const glm::vec2 cefPixels(_pTab->GetWebViewResolutionX(), _pTab->GetWebViewResolutionY());

	// WebView resolution
	glm::vec2 webViewPixels(_pTab->GetWebViewWidth(), _pTab->GetWebViewHeight());

	// Function transforms coordinate from relative WebView coordinates to CEFPixel coordinates on page
	const std::function<void(const float&, const glm::vec2&, const glm::vec2&, glm::vec2&)> pageCoordinate
		= [&](const float& rZoom, const glm::vec2& rRelativeZoomCoordinate, const glm::vec2& rRelativeCenterOffset, glm::vec2& rCoordinate)
	{
		// Analogous to shader in WebView
		rCoordinate += rRelativeCenterOffset; // add center offset
		rCoordinate -= rRelativeZoomCoordinate; // move zoom coordinate to origin
		rCoordinate *= rZoom; // apply zoom
		rCoordinate += rRelativeZoomCoordinate; // move back
		rCoordinate *= cefPixels; // bring into pixel space of CEF
	};

	// Function calling above function with current values
	const std::function<void(glm::vec2&)> currentPageCoordinate
		= [&](glm::vec2& rCoordinate)
	{
		pageCoordinate(_zoom, _relativeZoomCoordinate, _relativeCenterOffset, rCoordinate);
	};

	// Function to take pixel page values and returns relative WebView coordinates
	const std::function<void(const float&, const glm::vec2&, const glm::vec2&, glm::vec2&)> webViewCoordinate
		= [&](const float& rZoom, const glm::vec2& rRelativeZoomCoordinate, const glm::vec2& rRelativeCenterOffset, glm::vec2& rCoordinate)
	{
		rCoordinate /= cefPixels;
		rCoordinate -= rRelativeZoomCoordinate;
		rCoordinate /= rZoom; // inverse to WebView shader
		rCoordinate += rRelativeZoomCoordinate;
		rCoordinate -= rRelativeCenterOffset; // inverse to WebView shader
	};

	// Function calling above function with current values
	const std::function<void(glm::vec2&)> currentWebViewCoordinate
		= [&](glm::vec2& rCoordinate)
	{
		webViewCoordinate(_zoom, _relativeZoomCoordinate, _relativeCenterOffset, rCoordinate);
	};

	// Current raw! gaze (filtered here through zoom coordinate calculation)
	// glm::vec2 relativeGazeCoordinate(spInput->webViewRelativeRawGazeX, spInput->webViewRelativeRawGazeY); // relative WebView space

	// Current gaze in page pixel coordinates (filtered by custom transformation so filtered in page space!)
	glm::vec2 pixelGazeCoordinate(_spTrans->GetFilteredGazeX(TRANS_NAME), _spTrans->GetFilteredGazeY(TRANS_NAME));

	// Relative gaze coordinate in web view
	glm::vec2 relativeGazeCoordinate = pixelGazeCoordinate;
	currentWebViewCoordinate(relativeGazeCoordinate);

	// #########################
	// ### COORDINATE UPDATE ###
	// #########################

	// Only allow zoom in when gaze upon web view
	if (!spInput->gazeUponGUI && spInput->insideWebView)
	{
		// Update deviation value (fade away deviation)
		_deviation = glm::max(0.f, _deviation - (tpf / DEVIATION_FADING_DURATION));

		// Update coordinate
		if (!_firstUpdate) // normal update
		{
			// Caculate offset of gaze on page in comparison to zoom coordinate
			glm::vec2 pixelZoomCoordinate = _relativeZoomCoordinate * cefPixels;
			glm::vec2 pixelOffset = pixelGazeCoordinate - pixelZoomCoordinate;

			// Update zoom coordinate
			_relativeZoomCoordinate += (pixelOffset / cefPixels) * glm::min(1.f, (tpf / MOVE_DURATION));

			// Set normalized offset as deviation if bigger than current deviation
			float normOffset = glm::length(pixelOffset / glm::max(cefPixels.x, cefPixels.y));
			_deviation = glm::min(1.f, glm::max(normOffset, _deviation)); // limit to one

			// If at the moment a high deviation is given, try to zoom out to give user more overview
			zoomSpeed = (1.f / ZOOM_DURATION) - glm::min(1.f, DEVIATION_WEIGHT(_deviation));
		}
		else // first frame of execution
		{
			// Use raw coordinate as new coordinate
			_relativeZoomCoordinate = relativeGazeCoordinate;

			// Since only for first frame, do not do it again
			_firstUpdate = false;
		}

		// Calculated center offset. This moves the WebView content towards the center for better gaze precision
		glm::vec2 clampedRelativeZoom = glm::clamp(_relativeZoomCoordinate, glm::vec2(0.f), glm::vec2(1.f)); // clamp within page for determining relative center offset
		float zoomWeight = ((1.f - _zoom) / (1.f - MAX_ZOOM)); // projects zoom level to [0..1]
		_relativeCenterOffset =
			CENTER_OFFSET_MULTIPLIER
			* zoomWeight // weight with zoom (starting at zero) to have more centered version at higher zoom level
			* (clampedRelativeZoom - 0.5f); // vector from WebView center to current zoom coordinate
	}

	// Update linear zoom
	_linZoom += tpf * zoomSpeed; // frame rate depended, because zoomSpeed is depending on deviation which is depending on tpf

	// Clamp linear zoom (zero is standard, everything higher is zoomed)
	// _linZoom = glm::clamp(_linZoom, 0.f, 1.f);

	// Make zoom better with exponential function and some delay for orientation
	// float x = _linZoom;
	// float n = ZOOM_STEEPNESS;
	// _zoom = 1 - (glm::pow(x, n) / (glm::pow(x, n) + glm::pow(1 - x, n))); // apply ease in / out function

	// Trying something different
	_linZoom = glm::max(0.f, _linZoom);
	_zoom = glm::min(1.f, glm::exp(-(_linZoom - 0.1f)));

	// Scale
	// _zoom = (1.f - MAX_ZOOM) * _zoom + MAX_ZOOM;

	// #########################
	// ### SAMPLE EVALUATION ###
	// #########################

	// Update and clean samples
	std::for_each(_sampleData.begin(), _sampleData.end(), [&](SampleData& rSampleData) { rSampleData.lifetime -= tpf; });
	_sampleData.erase(
		std::remove_if(
			_sampleData.begin(),
			_sampleData.end(),
			[&](const SampleData& rSampleData) { return rSampleData.lifetime <= 0.f; }),
		_sampleData.end());

	// Add new sample storing current values
	_sampleData.push_back(SampleData(_zoom, relativeGazeCoordinate, _relativeZoomCoordinate, _relativeCenterOffset));

	// Decide whether zooming is finished
	SampleData sample = _sampleData.front();
	bool finished = false;
	if (sample.lifetime < 0.25f)
	{
		// ### WebView pixels

		// Current gaze in WebView pixels
		glm::vec2 pixelGaze = relativeGazeCoordinate * webViewPixels; // on screen

		// Sample gaze in WebView pixels
		glm::vec2 sampleRelativeGaze = sample.relativeGazeCoordinate;
		glm::vec2 samplePixelGaze = sampleRelativeGaze * webViewPixels; // on screen

		// Gaze delta between both gaze coordinates on screen
		glm::vec2 pixelGazeDelta = pixelGaze - samplePixelGaze; // on screen delta percepted by eye tracker

		// Center delta on screen
		glm::vec2 zoomCoordinate = _relativeZoomCoordinate * cefPixels; // CEF page pixels
		webViewCoordinate(_zoom, _relativeZoomCoordinate, _relativeCenterOffset, zoomCoordinate); // relative WebView
		zoomCoordinate *= webViewPixels; // WebView pixels
		glm::vec2 sampleZoomCoordinate = sample.relativeZoomCoordinate * cefPixels; // CEF page pixels
		webViewCoordinate(sample.zoom, sample.relativeZoomCoordinate, sample.relativeCenterOffset, sampleZoomCoordinate); // relative WebView
		sampleZoomCoordinate *= webViewPixels; // WebView pixels
		glm::vec2 pixelZoomCoordinateDelta = zoomCoordinate - sampleZoomCoordinate; // on screen delta

		// Remove offset introduced by center offset TODO: think about it, right now not integrated
		// glm::vec2 pixelCenterOffsetDelta = (_relativeCenterOffset - sample.relativeCenterOffset) * webViewPixels; // screen offset caused by center offset application
		// pixelGazeDelta -= pixelCenterOffsetDelta;
		// pixelZoomCoordinateDelta -= pixelCenterOffsetDelta; -> relative to page, not WebView

		// Bring pixel gaze delta from WebView pixels dimension to CEF webpage pixels dimension
		pixelGazeDelta = (pixelGazeDelta / webViewPixels) * cefPixels;
		pixelZoomCoordinateDelta = (pixelZoomCoordinateDelta / webViewPixels) * cefPixels;

		// ### CEF pixels

		// Radius in which fixated point on screen must have laid to cause such gaze delta through user tracking
		float z = glm::length(pixelZoomCoordinateDelta);
		float f = glm::length(pixelGazeDelta);
		float zoomA = 1.f / sample.zoom;
		float zoomB = 1.f / _zoom;
		float radius = (f - z + (zoomB * z)) / (zoomB - zoomA); // CEF pixels

		// Direction into which fixated point must have been moved
		glm::vec2 direction = glm::normalize(pixelGazeDelta);

		// Pixel position of zoom coordinate at sample record on page
		glm::vec2 samplePixelZoomCoordinate = sample.relativeZoomCoordinate * cefPixels;

		// Fixation in CEF pixels
		glm::vec2 pixelFixation = samplePixelZoomCoordinate + (direction * radius);

		// Output fixation
		LogInfo("Fixation: ", pixelFixation.x, ", ", pixelFixation.y);

		// Push back fixation
		_fixations.push_back(pixelFixation); // TODO limit etc

		// Go over last fixations and calculate deviation
		const int n = 5;
		const int size = _fixations.size();
		glm::vec2 mean(0, 0);
		for (int i = size - 1; i >= glm::max(0, size - n); i--)
		{
			mean += _fixations.at(i);
		}
		mean /= (float)glm::min(n, size);
		float deviation = 0;
		for (int i = size - 1; i >= glm::max(0, size - n); i--)
		{
			deviation += glm::distance(mean, _fixations.at(i));
		}
		deviation /= (float)glm::min(n, size);

		// Output fixation
		LogInfo("Deviation: ", deviation);

		// Fill output
		SetOutputValue("coordinate", pixelFixation);

		if (deviation < 1.f)
		{
			finished = true;
		}

		/*
		// Skip sample when no zoom happened etc., resulting in NaN
		if (!std::isnan(pixelFixation.x) && !std::isnan(pixelFixation.y))
		{
			// Collect fixations inclusive weight
			_potentialFixations.push_back(std::make_pair(pixelFixation, direction)); // fixation and direction of gaze delta

			// Aggregate collection
			glm::vec2 aggFixation(0, 0);
			float aggWeight = 0;
			for (int i = _potentialFixations.size() - 1; i >= 0; i--)
			{
				const auto& rFixation = _potentialFixations.at(i).first; // calculated fixation
				const auto& rDirection = _potentialFixations.at(i).second; // direction of gaze offset
				float angle = glm::abs(glm::degrees(glm::angle(rDirection, glm::normalize(pixelZoomCoordinateDelta))));
				float distance = glm::distance(rFixation, pixelFixation);
				angle = glm::max(angle, 1.f);
				distance = glm::max(distance, 1.f);
				float weight = glm::min(angle, distance);
				weight = 1.f / weight;
				aggFixation += rFixation * weight;
				aggWeight += weight;
				
			}
			if (aggWeight > 0)
			{
				aggFixation /= aggWeight;
			}

			LogInfo("AggFixation: ", aggFixation.x, ", ", aggFixation.y);
			
			if (supporters >= SUPPORTER_COUNT)
			{
				aggFixation /= (float)supporters;

				// Fill output
				SetOutputValue("coordinate", pixelFixation);

				finished = true;
				LogInfo("Drift correction applied");
			}
		}
		*/
	}

	// ##############
	// ### FINISH ###
	// ##############

	// Update custom transformation
	double webViewX = _pTab->GetWebViewX();
	double webViewY = _pTab->GetWebViewY();
	double webViewWidth = _pTab->GetWebViewWidth();
	double webViewHeight = _pTab->GetWebViewHeight();
	auto zoom = _zoom;
	auto relativeZoomCoordinate = _relativeZoomCoordinate;
	auto relativeCenterOffset = _relativeCenterOffset;
	_spTrans->ChangeCustomTransformation(
		TRANS_NAME,
		[webViewX, webViewY, webViewWidth, webViewHeight, zoom, relativeZoomCoordinate, relativeCenterOffset, cefPixels](double& x, double& y)
	{
		// Bring raw gaze into relative space of WebView
		glm::vec2 gaze(x, y); // double 2D vector
		gaze.x -= webViewX;
		gaze.y -= webViewY;
		gaze.x /= webViewWidth;
		gaze.y /= webViewHeight;
		gaze = glm::clamp(gaze, glm::vec2(0, 0), glm::vec2(1, 1));

		// Now transform to pixel space of webpage
		gaze += relativeCenterOffset; // add center offset
		gaze -= relativeZoomCoordinate; // move zoom coordinate to origin
		gaze *= zoom; // apply zoom
		gaze += relativeZoomCoordinate; // move back
		gaze *= cefPixels; // bring into pixel space of CEF

		// Set references
		x = gaze.x;
		y = gaze.y;
	}
	);

	// Finishing condition
	if (_zoom <= MAX_ZOOM)
	{
		finished = true;
	}

	// Decrement dimming
	_dimming += tpf;
	_dimming = glm::min(_dimming, DIMMING_DURATION);

	// Tell web view about zoom
	WebViewParameters webViewParameters;
	webViewParameters.centerOffset = _relativeCenterOffset;
	webViewParameters.zoom = _zoom;
	webViewParameters.zoomPosition = _relativeZoomCoordinate;
	if (_doDimming) { webViewParameters.dim = DIMMING_VALUE * (_dimming / DIMMING_DURATION); }
	_pTab->SetWebViewParameters(webViewParameters);

    // Return whether finished
    return finished;
}

void FutureCoordinateAction::Draw() const
{
	/*
	// Do draw some stuff for debugging
#ifdef CLIENT_DEBUG
	// WebView pixels
	glm::vec2 webViewPixels(_pTab->GetWebViewWidth(), _pTab->GetWebViewHeight());

	// Function to move coordinate according to current zoom. Takes relative WebView coordinate
	const std::function<void(glm::vec2&)> applyZooming = [&](glm::vec2& rCoordinate)
	{
		rCoordinate -= _relativeZoomCoordinate;
		rCoordinate /= _zoom; // inverse to WebView shader
		rCoordinate += _relativeZoomCoordinate;
		rCoordinate -= _relativeCenterOffset; // inverse to WebView shader
		rCoordinate *= webViewPixels;
	};

	// Zoom coordinate
	glm::vec2 zoomCoordinate(_relativeZoomCoordinate);
	applyZooming(zoomCoordinate);
	_pTab->Debug_DrawRectangle(zoomCoordinate, glm::vec2(5, 5), glm::vec3(1, 0, 0));

	// Click coordinate
	glm::vec2 coordinate;
	if (GetOutputValue("coordinate", coordinate)) // only show when set
	{
		// TODO: convert from CEF Pixel space to WebView Pixel space
		_pTab->Debug_DrawRectangle(coordinate, glm::vec2(5, 5), glm::vec3(0, 1, 0));
	}

	// Testing visualization
	glm::vec2 testCoordinate(0.3f, 0.5f);
	applyZooming(testCoordinate);
	_pTab->Debug_DrawRectangle(testCoordinate, glm::vec2(5, 5), glm::vec3(0, 0, 1));
#endif // CLIENT_DEBUG
*/
}

void FutureCoordinateAction::Activate()
{
	// TODO: could go wrong, as taken from weak pointer
	_spTrans = _pTab->GetCustomTransformationInterface().lock();
	_spTrans->RegisterCustomTransformation(TRANS_NAME, [](double& x, double& y) {}); // tell transformation to not transform anything
}

void FutureCoordinateAction::Deactivate()
{
	// Unregister transformation
	_spTrans->UnregisterCustomTransformation(TRANS_NAME);

	// Reset web view (necessary because of dimming)
	WebViewParameters webViewParameters;
	_pTab->SetWebViewParameters(webViewParameters);
}

void FutureCoordinateAction::Abort()
{
	_spTrans->UnregisterCustomTransformation(TRANS_NAME);
}
