//============================================================================
// Distributed under the Apache License, Version 2.0.
// Author: Raphael Menges (raphaelmenges@uni-koblenz.de)
//============================================================================
// Connects output ActionDataMap of one Action with input ActionDataMap of other.

#ifndef ACTIONCONNECTOR_H_
#define ACTIONCONNECTOR_H_

#include "src/State/Web/Tab/Pipelines/Actions/Action.h"
#include <map>
#include <memory>

class ActionConnector
{
public:

    // Constructor
    ActionConnector(std::weak_ptr<const Action> wpPrevious, std::weak_ptr<Action> wpNext);

    // Execute connection (should be done after previous action is executed and next is about to be)
    void Execute();

    // Get pointer to previous to decide about execution
	std::weak_ptr<const Action> GetPreviousAction() const { return _wpPrevious; }

    // Connect
    void ConnectInt(std::string previousType, std::string nextType);
    void ConnectFloat(std::string previousType, std::string nextType);
    void ConnectVec2(std::string previousType, std::string nextType);
    void ConnectString(std::string previousType, std::string nextType);
    void ConnectString16(std::string previousType, std::string nextType);

private:

	// Private execute. Executes copying of values for one datatype.
	template <typename T>
	void Execute(std::map<std::string, std::string>& rConnectionMap)
	{
		for (const auto& rConnection : rConnectionMap)
		{
			T value;
			if (auto spPrevious = _wpPrevious.lock()) { spPrevious->GetOutputValue(rConnection.first, value); }
			if (auto spNext = _wpNext.lock()) { spNext->SetInputValue(rConnection.second, value); }
		}
	}

    // Pointer to actions
    std::weak_ptr<const Action> _wpPrevious;
	std::weak_ptr<Action> _wpNext;

    // Map of connections
    std::map<std::string, std::string> _intConnections;
    std::map<std::string, std::string> _floatConnections;
    std::map<std::string, std::string> _vec2Connections;
    std::map<std::string, std::string> _stringConnections;
    std::map<std::string, std::string> _string16Connections;
};

#endif // ACTIONCONNECTOR_H_
