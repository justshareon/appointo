#!/bin/bash

echo "========================================"
echo "Fleet Application - Test Suite Runner"
echo "========================================"
echo ""
echo "This will run 20 real-time test scenarios"
echo "Make sure backend server is running on port 5000"
echo ""
read -p "Press Enter to continue..."

cd backend
node test_fleet_realtime.js

read -p "Press Enter to exit..."

