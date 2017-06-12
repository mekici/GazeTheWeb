//============================================================================
// Distributed under the Apache License, Version 2.0.
// Author: Raphael Menges (raphaelmenges@uni-koblenz.de)
//============================================================================

#ifndef EYETRACKER_H_
#define EYETRACKER_H_

// Decide about api style by define
#ifdef DLL_IMPLEMENTATION  
#define DLL_API __declspec(dllexport)   
#else  
#define DLL_API __declspec(dllimport)   
#endif  

#include "plugins/Eyetracker/Interface/EyetrackerSampleData.h"

// Export C interface (resolved overloading etc)
#ifdef __cplusplus
extern "C" {
#endif

	// Connect eyetracker, returns whether succesfull
	DLL_API bool Connect();

	// Check whether eyetracker is working (regardless of user presence)
	DLL_API bool IsTracking();

	// Disconnect eyetracker, returns whether succesfull
	DLL_API bool Disconnect();

	// Fetches gaze samples and clears buffer
	DLL_API void FetchSamples(SampleQueue& rupSamples);

	// Perform calibration TODO: return something like an enum or so to provide user feedback
	DLL_API void Calibrate();

#ifdef __cplusplus
}
#endif

#endif // EYETRACKER_H_