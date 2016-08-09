// https://developer.mozilla.org/de/docs/Web/API/MutationObserver

// Global variables in which DOM relevant information is stored
window.fixed_elements = new Set();
window.fixed_IDlist = [];				// Position |i| contains boolean information if ID |i| is currently used
window.fixed_coordinates = [[]];		// 2D list of bounding rectangle coordinates, fill with bounding rect coordinates of fixed node and its children (if position == 'relative')

window.dom_links = [];
window.dom_links_rect = [[]];

window.dom_textinputs = [];
window.dom_textinputs_rect = [[]];






// Helper function for console output
function consolePrint(msg)
{
	window.cefQuery({ request: msg, persistent : false, onSuccess : function(response) {}, onFailure : function(error_code, error_message){} });
}

// TODO: Add as global function and also use it in DOM node work
/**
	Adjust bounding client rectangle coordinates to window, using scrolling offset and zoom factor.

	@param: DOMRect, as returned by Element.getBoundingClientRect()
	@return: Double array with length = 4, containing coordinates as follows: top, left, bottom, right
*/
function AdjustRectCoordinatesToWindow(rect)
{
	var doc = document.documentElement;
	var zoomFactor = 1;
	var offsetX = (window.pageXOffset || doc.scrollLeft) - (doc.clientLeft || 0); 
	var offsetY = (window.pageYOffset || doc.scrollTop) - (doc.clientTop || 0); 

	var docRect = document.body.getBoundingClientRect();

	if(document.body.style.zoom)
	{
		zoomFactor = document.body.style.zoom;
	}

	var output = [];
	output.push(rect.top*zoomFactor + offsetY);
	output.push(rect.left*zoomFactor + offsetX);
	output.push(rect.bottom*zoomFactor + offsetY);
	output.push(rect.right*zoomFactor + offsetX);

	return output;
}

// Only used for fixed elements
function AdjustRectToZoom(rect)
{
	var zoomFactor = 1;
	if(document.body.style.zoom)
	{
		zoomFactor = document.body.style.zoom;
	};

	var output = [];
	output.push(rect.top*zoomFactor);
	output.push(rect.left*zoomFactor);
	output.push(rect.bottom*zoomFactor);
	output.push(rect.right*zoomFactor);

	return output;
}



// Used to get coordinates as array of size 4 in RenderProcessHandler
// function GetRect(node){ return AdjustRectCoordinatesToWindow(node.getBoundingClientRect()); }


function CompareRectData(node_list, rect_list, NotificationFunc)
{
	var n = node_list.length;

	for(var i = 0; i < n; i++)
	{
		var new_rect = AdjustRectCoordinatesToWindow(
			node_list[i].getBoundingClientRect()
		);

		// Adjust coordinates to fixed screen position if needed
		if(node_list[i].hasAttribute('fixedID'))
		{
			SubstractScrollingOffset(new_rect);
		}

		var old_rect = rect_list[i];

		if(new_rect[0] != old_rect[0] || new_rect[1] != old_rect[1] || new_rect[2] != old_rect[2] || new_rect[3] != old_rect[3])
		{
			NotificationFunc(i, new_rect);
		}

	}
}

// Modified version for text link normalization
function CompareRectData2(node_list, rect_list, NotificationFunc)
{
	var n = node_list.length;

	for(var i = 0; i < n; i++)
	{
		var new_rect = GetNormalizedLinkRect(node_list[i]);

		// Adjust coordinates to fixed screen position if needed
		if(node_list[i].hasAttribute('fixedID'))
		{
			// TODO: Handle more than 1 Rect (aka more than array of length 4)
			// for(var j = 0, m = new_rect.length / 4; j++)
			// {
				SubstractScrollingOffset(new_rect);
			// }
			
		}

		var old_rect = rect_list[i];

		if(new_rect[0] != old_rect[0] || new_rect[1] != old_rect[1] || new_rect[2] != old_rect[2] || new_rect[3] != old_rect[3])
		{
			NotificationFunc(i, new_rect);
		}

	}
}

// being lazy
function RectToString(rect)
{
	return ''+rect[0]+';'+rect[1]+';'+rect[2]+';'+rect[3];
}

	/* NOTES
		Encoding of request strings for DOM node operations:

		DOM#{add | rem | upd}#nodeType#nodeID{#attribute#data}#

		Definitions:
		nodeType	: int
			0 : TextInput
			1 : TextLink
		nodeID		: int
		add --> send process message to Renderer to fetch V8 data
		rem --> request removal of given node
		upd --> update data of an specific node attribute
		attribute	: int
			0	: Rect
		data	: depends on attribute
	*/

function UpdateDOMRects()
{
	// Compare node's current Rect with data in Rect list
	CompareRectData(
		window.dom_links, 
		window.dom_links_rect, 
		function Notify(i, rect) { 
			consolePrint('DOM#upd#1#'+i+'#0#'+RectToString(rect)+'#');
		} 
	);

	CompareRectData2(
		window.dom_textinputs, 
		window.dom_textinputs_rect, 
		function Notify(i, rect) { 
			consolePrint('DOM#upd#0#'+i+'#0#'+RectToString(rect)+'#');
		} 
	);

}

function UpdateFixedElementRects()
{
	window.fixed_elements.forEach(
		function (node){
			var id = node.getAttribute('fixedID');

			var preUpdate = window.fixed_coordinates[id];

			window.fixed_coordinates[id] = AdjustRectToZoom(
				node.getBoundingClientRect()
			);

			UpdateSubtreesBoundingRect(node);

			// UpdateSubtreesBoundingRects only informs CEF if child nodes' Rect exists or changes
			// So, check if updates took place has to be done here
			var equal = (preUpdate.length == window.fixed_coordinates.length);
			for(var i = 0, n = preUpdate.length; i < n && equal; i++)
			{
				equal &= (preUpdate[i] == window.fixed_coordinates[i]);
			}
			
			if(!equal)
			{
				var zero = '';
				if(id < 10) zero = '0';
				// Tell CEF that fixed node was updated
				consolePrint('#fixElem#add#'+zero+id);	// TODO: Change String encoding, get rid of 'zero'
			}

		}
	);


}

function AddDOMTextInput(node)
{
	// DEBUG
	//consolePrint("START adding text input");

	// Add text input node to list of text inputs
	window.dom_textinputs.push(node);

	// Add text input's Rect to list
	window.dom_textinputs_rect.push(
		AdjustRectCoordinatesToWindow(
			node.getBoundingClientRect()
		)
	);

	// Add attribute in order to recognize already discovered DOM nodes later
	node.setAttribute('nodeType', '0');
	node.setAttribute('nodeID', (window.dom_textinputs.length-1));

	// Inform CEF, that new text input is available
	var node_amount = window.dom_textinputs.length - 1;
	consolePrint('DOM#add#0#'+node_amount+'#');

	// DEBUG
	//consolePrint("END adding text input");
}

function SubstractScrollingOffset(rectData)
{
	// Translate rectData by (-scrollX, -scrollY)
	rectData[0] -= window.scrollY;
	rectData[1] -= window.scrollX;
	rectData[2] -= window.scrollY;
	rectData[3] -= window.scrollX;
	return rectData;
}

// Iterate over Set of already used fixedIDs to find the next ID not yet used and assign it to node as attribute
function AddFixedElement(node)
{
	// Determine fixed element ID
	var id;

	if(node.hasAttribute('fixedID'))
	{
		// node already in set, use existing ID
		id = node.getAttribute('fixedID');

		// Check if bounding Rect changes happened
		UpdateSubtreesBoundingRect(node);
	}
	else
	{
		// Add node to set of fixed elements, if position is fixed
		window.fixed_elements.add(node);

		// Find smallest ID not yet in use

		var found = false;
		for(var i=0, n=window.fixed_IDlist.length; i < n; i++)
		{
			if(!window.fixed_IDlist[i])
			{
				window.fixed_IDlist[i] = true;
				id = i;
				found = true;
			}
		}
		if(!found)
		{
			// Extend ID list by one entry
			window.fixed_IDlist.push(true);
			// Use new last position as ID
			id = window.fixed_IDlist.length-1;
		}

		// Create attribute in node and store ID there
		node.setAttribute('fixedID', id);

		// Write node's (and its children's) bounding rectangle coordinates to List
		SaveBoundingRectCoordinates(node);
	}

	// TODO: Add attribute 'fixedID' to every child node



	var zero = '';
	if(id < 10) zero = '0';
	// Tell CEF that fixed node was added
	consolePrint('#fixElem#add#'+zero+id);
}


function SaveBoundingRectCoordinates(node)
{
	var rect = node.getBoundingClientRect();
	// Only add coordinates if width and height are greater zero
	// if(rect.width && rect.height)
	// {
	var id = node.getAttribute('fixedID');

	
	// Add empty 1D array to 2D array, if needed
	while(window.fixed_coordinates.length <= id)
	{
		window.fixed_coordinates.push([]);
	}

	// 1D array with top, left, bottom, right values of bounding rectangle
	var rect_coords = AdjustRectToZoom(
		node.getBoundingClientRect()
	);
	
	// Add rect coordinates to list of fixed coordinates at position |id|
	window.fixed_coordinates[id] = rect_coords;

	// Compute bounding rect containing all child nodes
	var tree_rect_coords = ComputeBoundingRectOfAllChilds(node, 0, id);

	// Save tree rect, if different than fixed nodes bounding rect
	var equal = true;
	for(var i = 0; i < 4 && equal; i++)
	{
		equal &= (rect_coords[i] == tree_rect_coords[i]);
	}
	if(!equal)
	{
		window.fixed_coordinates[id] = 
			window.fixed_coordinates[id].concat(
				ComputeBoundingRect(rect_coords, tree_rect_coords)
			);
	}
}

// Inform CEF about the current fication status of a already known node
function SetFixationStatus(node, status)
{
	var type = node.getAttribute('nodeType');
	var id = node.getAttribute('nodeID');

	if(type && id)
	{
		// Inform about updates in node's attribute |1| aka |_fixed : bool|
		// _fixed = status;
		var intStatus = (status) ? 1 : 0;
		consolePrint('DOM#upd#'+type+'#'+id+'#1#'+intStatus+'#');

		//DEBUG
		//consolePrint('Setting fixation status to '+intStatus);
	}
}

// parent & child are 1D arrays of length 4
function ComputeBoundingRect(parent, child)
{
	// if(parent.height == 0 || parent.width == 0)
	if(parent[2]-parent[0] == 0 || parent[3]-parent[1] == 0)
		return child;

	return [Math.min(parent[0], child[0]),
			Math.min(parent[1], child[1]),
			Math.max(parent[2], child[2]),
			Math.max(parent[3], child[3])];
}

function ComputeBoundingRectOfAllChilds(node, depth, fixedID)
{
	// Check if node's bounding rectangle is outside of the current union of rectangles in |window.fixed_coordinates[id]|
	if(node.nodeType == 1) // 1 == ELEMENT_NODE
	{

		// Add attribute 'fixedID' in order to indicate being a child of a fixed node
		if(!node.hasAttribute('fixedID'))
		{
			node.setAttribute('fixedID', fixedID);
		}

		// Inform CEF that DOM node is child of a fixed element
		if(node.hasAttribute('nodeType'))
		{
			SetFixationStatus(node, true);
		}

		var rect = node.getBoundingClientRect();

		// Compare nodes to current bounding rectangle of all child nodes
		var rect_coords = AdjustRectToZoom(rect);

		// Traverse all child nodes
		if(node.children && node.children.length > 0)
		{
			var n = node.children.length;

			for(var i=0; i < n ; i++)
			{		
				// Compare previously computed bounding rectangle with the one computed by traversing the child node
				rect_coords = 
					ComputeBoundingRect(
						rect_coords,
						ComputeBoundingRectOfAllChilds(node.children.item(i), depth+1, fixedID)
					);
			}
		}


		return rect_coords;
	}

	// Error case
	return [-1,-1,-1,-1]; // TODO: nodeType != 1 possible? May ruin the whole computation
}

// If resetChildren=true, traverse through all child nodes and remove attribute 'fixedID'
// May not be neccessary if node (and its children) were completely removed from DOM tree
function RemoveFixedElement(node, resetChildren)
{
	// Remove node from Set of fixed elements
	window.fixed_elements.delete(node);

	if(node.hasAttribute('fixedID'))
	{
		var id = node.getAttribute('fixedID');
		// Remove fixedID from ID List
		window.fixed_IDlist[id] = false;
		// Delete bounding rectangle coordinates for this ID
		window.fixed_coordinates[id] = [];

		var zero = '';
		if(id < 10) zero = '0';

		// Tell CEF that fixed node with ID was removed
		consolePrint('#fixElem#rem#'+zero+id);
		// Remove 'fixedID' attribute
		node.removeAttribute('fixedID');

		if(resetChildren && node.children)
		{
			UnfixChildNodes(node.children);
		}
	}
}

function UnfixChildNodes(childNodes)
{
	for(var i = 0, n = childNodes.length; i < n; i++)
	{
		childNodes[i].removeAttribute('fixedID');
		
		SetFixationStatus(childNodes[i], false);

		if(childNodes[i].children)
		{
			UnfixChildNodes(childNodes[i].children);
		}
	}
}

// Traverse subtree starting with given childNode as root
function UpdateSubtreesBoundingRect(childNode)
{

	var id = childNode.getAttribute('fixedID');

	// consolePrint('Checking #'+id+' for updates...');

	// Read out old rectangle coordinates
	var old_coords = window.fixed_coordinates[id];
	// Update bounding rectangles (only for subtree, starting with node where changes happend)
	var child_coords = ComputeBoundingRectOfAllChilds(childNode, 0, id);

	// consolePrint('child: '+child_coords);
	// consolePrint('old  : '+old_coords);
	var inform_about_changes = false;
	var parent_rect = old_coords.slice(0, 4);

	// Parent rect hasn't been containing all child rects
	if(old_coords.length > 4)
	{
		var old_child_rect = old_coords.slice(4, 8);

		// Inform CEF that coordinates have to be updated
		if(!CompareArrays(child_coords, parent_rect) && !CompareArrays(child_coords, old_child_rect))
		{

			// Update childrens' combined bounding rect 
			window.fixed_coordinates[id] = parent_rect.concat(child_coords);
			// alert('new: '+new_coords+'; old: '+old_coords);
			// consolePrint("Updated subtree's bounding rect: "+window.fixed_coordinates[id]);

			inform_about_changes = true;
		}
	}
	else // Parent rect has been containing all child rects
	{
		// Check if new child rect is contained in parent rect
		child_coords = ComputeBoundingRect(parent_rect, child_coords);
		if(!CompareArrays(parent_rect, child_coords))
		{
			window.fixed_coordinates[id] = parent_rect.concat(child_coords);

			inform_about_changes = true;
		}
		// else: Parent rect still contains updated child rect
	}


	if(inform_about_changes)
	{
		var zero = '';
		if(id < 10) zero = '0';
		// Tell CEF that fixed node's coordinates were updated
		consolePrint('#fixElem#add#'+zero+id);

		//DEBUG
		consolePrint('Updated a fixed element');
		for(var i = 0, n = window.fixed_coordinates.length; i < n ; i++)
		{
			var str = (i == id) ? '<---' : '';
			consolePrint(i+': '+window.fixed_coordinates[i]+str);
		}

		// DEBUG
		// consolePrint("UpdateSubtreesBoundingRect()");
	}

}

function CompareArrays(array1, array2)
{
	if(array1.length != array2.length)
		return false;

	for(var i = 0, n = array1.length; i < n; i++)
	{
		if(array1[i] != array2[i])
			return false;
	}

	return true;
}

function AddDOMTextLink(node)
{
	// DEBUG
	//consolePrint("START adding text link");

	window.dom_links.push(node);

	var rectData = GetNormalizedLinkRect(node);
	// var coords = AdjustRectCoordinatesToWindow(rect); //[rect.top, rect.left, rect.bottom, rect.right];
	window.dom_links_rect.push(rectData);


	// Add attribute in order to recognize already discovered DOM nodes later
	node.setAttribute('nodeType', '1');
	node.setAttribute('nodeID', (window.dom_links.length-1));

	// Tell CEF message router, that DOM Link was added
	consolePrint('DOM#add#1#'+(window.dom_links.length-1)+'#');

		// DEBUG
	//consolePrint("END adding text link");
}

// Trigger DOM data update on changing document loading status
document.onreadystatechange = function()
{
	// consolePrint("### DOCUMENT STATECHANGE! ###");

	if(document.readyState == 'loading')
	{
		consolePrint('### document.readyState == loading ###'); // Never triggered
	}

	if(document.readyState == 'interactive')
	{
		//consolePrint("document reached interactive state: Updating DOM Rects...");

		UpdateDOMRects();

		//consolePrint("... done with Updating DOM Rects.");

	}

	if(document.readyState == 'complete')
	{
		UpdateDOMRects();
		consolePrint('Page fully loaded. #TextInputs='+window.dom_textinputs.length+', #TextLinks='+window.dom_links.length);

			consolePrint("Normalizing link Rects...");
		// NormalizeLinkRects();

		
	}
}

function GetNormalizedLinkRect(node)
{
	var linkText = node.textContent;

	// Only text links with a ' ' or '-' may be cause a line break
	if(linkText.includes(' ') || linkText.includes('-'))
	{
		var rectData = AdjustRectCoordinatesToWindow(node.getBoundingClientRect());
		var parent = node.parentNode;

		var firstChar = node.textContent[0];
		var lastChar = node.textContent[node.textContent.length-1];

		// Set up two new nodes for text beginning and ending
		var firstNode = node.cloneNode(node);
		firstNode.textContent = firstChar;
		var lastNode = node.cloneNode(node);
		lastNode.textContent = lastChar;

		// Adjust text of current text link node, remove first and last char
		node.textContent = node.textContent.substring(1,node.textContent.length-1);

		// Insert new nodes before and after targeted link node
		parent.insertBefore(firstNode, node);
		parent.insertBefore(lastNode, node.nextSibling);

		// Get bounding Rects of first/last char
		var firstRectData = AdjustRectCoordinatesToWindow(firstNode.getBoundingClientRect());
		var lastRectData = AdjustRectCoordinatesToWindow(lastNode.getBoundingClientRect());

		var rectResult;

		// Detect line break
		if( (firstRectData[2]-firstRectData[0]) * 1.8 < (rectData[2]-rectData[0]) && (firstRectData[2]-firstRectData[0]) > 0 )
		{
			// consolePrint(linkText);
			// consolePrint('rect  h: '+ (rectData[2]-rectData[0]) );
			// consolePrint('first h: '+ (firstRectData[2]-firstRectData[0]) );
			// consolePrint('last  h: '+ (lastRectData[2]-lastRectData[0]) ) ;

			// AddDOMTextLink(lastNode);
			// AddDOMTextLink(firstNode);

			// Bounding Rect before line break
			rectResult = [firstRectData[0], firstRectData[1], firstRectData[2], rectData[3]];

			// consolePrint('new rect: '+window.dom_links_rect[i]);

			// consolePrint('Link #'+linkText+'# was split, because of a line break');
			
			// Bounding Rect after line break
			// var rectExtension = [lastRectData[0], rectData[1], lastRectData[2], lastRectData[3]];
			// for(var j = 0; j < 4; j++)
			// {
			// 	window.dom_links_rect.push(rectExtension[i]);
			// }
			

			// TODO: Extend C++ DOMTextLink by second Rect attribute
		
			// TODO: Add HTML attribute, which identifies that DOM node was split
			
		}
		else
		{
			rectResult = rectData;	
		}

		// Clean-up all DOM tree changes
		parent.removeChild(firstNode);
		parent.removeChild(lastNode);
		node.textContent = linkText;

		return rectResult;

	}
	else
	{
		return AdjustRectCoordinatesToWindow(node.getBoundingClientRect());
	}
	

}


window.onresize = function()
{
	//UpdateDOMRects();
	// TODO: Update fixed elements' Rects too?
	// consolePrint("Javascript detected window resize, update of fixed element Rects.");

	// UpdateFixedElementRects();
}


// Instantiate and initialize the MutationObserver
function MutationObserverInit()
{ 
	consolePrint('Initializing Mutation Observer ... ');

	window.observer = new MutationObserver(
		function(mutations) {
		  	mutations.forEach(
		  		function(mutation)
		  		{
					// DEBUG
					//consolePrint("START Mutation occured...");

			  		var node;
					
		  			if(mutation.type == 'attributes')
		  			{
		  				node = mutation.target;
			  			var attr; // attribute name of attribute which has changed

		  				// TODO: How to identify node whose attributes changed? --> mutation.target?
		  				if(node.nodeType == 1) // 1 == ELEMENT_NODE
		  				{
		  					attr = mutation.attributeName;

		  					// usage example: observe changes in input field text
		  					// if (node.tagName == 'INPUT' && node.type == 'text')
		  					// 	alert('tagname: \''+node.tagName+'\' attr: \''+attr+'\' value: \''+node.getAttribute(attr)+'\' oldvalue: \''+mutation.oldValue+'\'');

		  					if(attr == 'style' || 
							   (document.readyState != 'loading' && attr == 'class') ) // TODO: example: uni-koblenz.de - node.id='header': class changes from 'container' to 'container fixed'
		  					{
		  						// alert('attr: \''+attr+'\' value: \''+node.getAttribute(attr)+'\' oldvalue: \''+mutation.oldValue+'\'');
		  						if(window.getComputedStyle(node, null).getPropertyValue('position') == 'fixed')
		  						// if(node.style.position && node.style.position == 'fixed')
		  						{
		  							if(!window.fixed_elements.has(node))
		  							{
		  								//DEBUG
		  								// consolePrint("Attribut "+attr+" changed, calling AddFixedElement");

		  								AddFixedElement(node);
		  							}
		  				
		  						}
		  						else // case: style.position not fixed
		  						{
		  							// If contained, remove node from set of fixed elements
		  							if(window.fixed_elements.has(node))
		  							{
		  								RemoveFixedElement(node, true);

										UpdateDOMRects();
		  							}
		  						}

		  					}

		  					// Changes in attribute 'class' may indicate that bounding rect update is needed, if node is child node of a fixed element
		  					if(attr == 'class')
		  					{
		  						if(node.hasAttribute('fixedID'))
		  						{
		  							//DEBUG
		  							// consolePrint("class changed, updating subtree");
									UpdateDOMRects();

		  							UpdateSubtreesBoundingRect(node);

									


		  							// TODO: Triggered quite often... (while scrolling)
		  						}
		  					}

		  					// if(attr == 'href')
		  					// {
		  					// 	AddFixedElement(node);
		  					// 	consolePrint("Changes in attribute |href|, adding link..");
		  					// }

		  				}

		  			}





		  			if(mutation.type == 'childList') // TODO: Called upon each appending of a child node??
		  			{
		  				// Check if fixed nodes have been added as child nodes
			  			var nodes = mutation.addedNodes;

			  			for(var i=0, n=nodes.length; i < n; i++)
			  			{
			  				node = nodes[i]; // TODO: lots of data copying here??
			  				var rect;

			  				if(node.nodeType == 1) // 1 == ELEMENT_NODE
			  				{

			  					// if(node.style.position && node.style.position == 'fixed')
		  						if(window.getComputedStyle(node, null).getPropertyValue('position') == 'fixed')
		  						{
		  							// consolePrint('position: '+node.style.position);
		  							if(!window.fixed_elements.has(node)) // TODO: set.add(node) instead of has sufficient?
		  							{
		  								//DEBUG
		  								// consolePrint("New fixed node added to DOM tree");

		  								AddFixedElement(node);

										UpdateDOMRects();
		  							}
		  						}


		  						// Find text links
		  						if(node.tagName == 'A')
		  						{	
									// DEBUG
									var nope = false;
									var parent = node.parentNode;
									var myTitle = 'Bundesamt für Ausrüstung, Informationstechnik und Nutzung der Bundeswehr';
									
									if(parent && parent.tagName == 'P' &&
									 node.getAttribute('title') == myTitle)
									{
										// if(parent && node.text && parent.tagName)
										// 	consolePrint('link: '+node.text+ '; title: '+node.title+'; parent.tagName='+parent.tagName);
										// alert('Found specific link on wikipedia!');
										// AddDOMTextLink(parent); // worked!
										
										// node.text = 'random text für den node';
										consolePrint("tricky rect: "+AdjustRectCoordinatesToWindow(node.getBoundingClientRect()));
										// var childs = parent.childNodes;
										// consolePrint("Found "+childs.length+" possible string children");
										// for(var i = 0, n = childs.length; i < n; i++)
										// {
										// 	var rect = [-1,-1,-1,-1];
											
										// 	consolePrint(i+": #"+childs[i].textContent+" rect: "+rect);
										// 	// // Note: Beware! No DOM Elements anymore!
										// 	// if (childs[i].textContent == myTitle)
										// 	// {
												
										// 	// 	consolePrint("Found myTitle as textContent");
										// 	// 	nope = true;
										// 	// }
											
										// }


									}

									if(!nope)
										AddDOMTextLink(node);
									
		  						}


								// Find input fields
		  						if(node.tagName == 'INPUT')
		  						{
		  							// Identify text input fields
		  							if(node.type == 'text' || node.type == 'search' || node.type == 'email' || node.type == 'password')
		  							{
		  								AddDOMTextInput(node);
		  							}
		  						}


			  				}
			  			}





			  			// Check if fixed nodes have been removed as child nodes and if yes, delete them from list of fixed elements
			  			var removed_nodes = mutation.removedNodes;
			  			for(var i=0, n=removed_nodes.length; i < n; i++)
			  			{
			  				node = removed_nodes[i];

			  				if(node.nodeType == 1)
			  				{
								if(window.fixed_elements.has(node))
								{
									RemoveFixedElement(node, false);

									UpdateDOMRects();
								}

								// TODO: Removal of relevant DOM node types??
			  				}
			  			}

		  			}

					// DEBUG
					//consolePrint("END Mutation occured...");
		  		} // end of function(){...}


		 	);    
		}
	);



	// TODO:

	// characterData vs. attributes - one of those not neccessary?

	// attributeFilter -
	// Mit dieser Eigenschaft kann ein Array mit lokalen Attributnamen angegeben werden (ohne Namespace), wenn nicht alle Attribute beobachtet werden sollen.
	// --> nur relevante Attribute beobachten!

	consolePrint('MutationObserver successfully created! Telling him what to observe... ');
	consolePrint('Trying to start observing... ');
		
	// Konfiguration des Observers: alles melden - Änderungen an Daten, Kindelementen und Attributen
	var config = { attributes: true, childList: true, characterData: true, subtree: true, characterDataOldValue: false, attributeOldValue: false};
	
	// eigentliche Observierung starten und Zielnode und Konfiguration übergeben
	window.observer.observe(window.document, config);

	consolePrint('MutationObserver was told what to observe.');

	// TODO: Tweak MutationObserver by defining a more specific configuration




	/*
	documentObserver = new MutationObserver(
		function(mutations) {
		  	mutations.forEach(
		  		function(mutation)
		  		{
					// DEBUG
					//consolePrint("START Mutation occured...");

			  		//var node;
					
		  			if(mutation.type == 'attributes')
		  			{
		  				var attr = mutation.attributeName;
						consolePrint('DOCUMENT OBSERVER!   '+attr);

					}
				}
			);
		}
	);

	var config = { attributes: true, childList: false, characterData: true, subtree: false, characterDataOldValue: false, attributeOldValue: false};
	
	// eigentliche Observierung starten und Zielnode und Konfiguration übergeben
	documentObserver.observe(window.document.documentElement, config);
	*/
	
} // END OF MutationObserverInit()

function MutationObserverShutdown()
{
	window.observer.disconnect(); 

	delete window.observer;

	consolePrint('Disconnected and deleted MutationObserver! ');
}

		  				// https://developer.mozilla.org/de/docs/Web/API/Node
		  				// https://developer.mozilla.org/de/docs/Web/API/Element
		  				// http://stackoverflow.com/questions/9979172/difference-between-node-object-and-element-object
		  				// read also: http://www.backalleycoder.com/2013/03/18/cross-browser-event-based-element-resize-detection/

		  												// offtopic: check if attributes exist
								// if(nodes[i].hasOwnProperty('style'))

			  					// http://ryanmorr.com/understanding-scope-and-context-in-javascript/