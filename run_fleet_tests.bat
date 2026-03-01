@echo off
echo ========================================
echo Fleet Application - Test Suite Runner
echo ========================================
echo.
echo This will run 20 real-time test scenarios
echo Make sure backend server is running on port 5000
echo.
pause

cd backend
node test_fleet_realtime.js

pause

