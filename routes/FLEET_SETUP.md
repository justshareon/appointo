# Fleet Dashboard Setup Guide

## Database Setup

### Option 1: Run the setup script (Recommended)
```bash
cd backend
node setup_fleet_tables.js
```

### Option 2: Run SQL directly
```bash
mysql -h <your-host> -u <user> -p <database> < fleet_schema.sql
```

## Tables Created

1. **fleet_queues** - Driver queue entries for port/gate access
2. **fleet_trips** - Active and completed trips
3. **fleet_road_conditions** - Road condition reports
4. **fleet_hazards** - Driver-reported hazards
5. **fleet_driver_stats** - Daily driver statistics
6. **fleet_gates** - Port/gate locations

## API Endpoints

All endpoints require authentication (JWT token in Authorization header).

### Queue Management
- `GET /api/fleet/queue/active` - Get driver's active queue
- `POST /api/fleet/queue/join` - Join a queue at a gate
  ```json
  {
    "gate_id": "gate_7",
    "vendor_id": "v_fleet1" // optional
  }
  ```

### Road Conditions
- `GET /api/fleet/road-conditions?lat=37.8044&lng=-122.2711&radius=5` - Get road conditions near location

### Hazard Reporting
- `POST /api/fleet/hazards/report` - Report a hazard
  ```json
  {
    "type": "pothole",
    "latitude": 37.8044,
    "longitude": -122.2711,
    "description": "Large pothole on main road",
    "image_url": "https://..." // optional
  }
  ```

### Driver Stats
- `GET /api/fleet/drivers/:driverId/stats?date=2026-01-15` - Get driver statistics
- `GET /api/fleet/drivers/:driverId/trips/active` - Get active trips

### Gates
- `GET /api/fleet/gates?vendor_id=v_fleet1` - Get all active gates

## Testing

1. **Start backend server:**
   ```bash
   cd backend
   npm run start:mysql
   ```

2. **Login as fleet user:**
   - Email: `fleetuser1@test.com` or `fleetvendor1@test.com`
   - Mobile: `8000000007` or `8000000008`

3. **Access Fleet Dashboard:**
   - Navigate to: `http://localhost:19006/fleet-dashboard`
   - Or from Fleet Screen, click "Open Dashboard"

## Sample Data

The setup script seeds 3 sample gates:
- `gate_7` - Port of Oakland - Gate 7
- `gate_12` - Port of Oakland - Gate 12  
- `gate_1` - Port of Los Angeles - Gate 1

