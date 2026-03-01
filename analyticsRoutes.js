const express = require('express');
const router = express.Router();
const db = require('./database');

// Helper to calculate date range
const getDateRange = (days) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    return { start, end };
};

// --- SUPER ADMIN ANALYTICS ---

// 1. Overview Counts
router.get('/super/overview', async (req, res) => {
    try {
        const users = await db.getUsers();
        const vendors = await db.getVendors(false);
        const appointments = await db.getAllAppointments();
        const products = await db.getAllProducts();
        const orders = await db.getAllOrders();
        
        const userCount = users.filter(u => u.role === 'user').length;
        const vendorCount = vendors.length;
        const appointmentCount = appointments.length;
        const productCount = products.length;
        const orderCount = orders.length;
        const totalRevenue = orders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
        
        res.json({
            users: userCount,
            vendors: vendorCount,
            appointments: appointmentCount,
            products: productCount,
            orders: orderCount,
            revenue: totalRevenue
        });
    } catch (e) {
        console.error("Analytics Overview Error:", e);
        res.status(500).json({ error: "Failed to fetch overview" });
    }
});

// 2. Appointments by Status (Pie Chart)
router.get('/super/appointments-by-status', async (req, res) => {
    try {
        const appointments = await db.getAllAppointments();
        const statusCounts = appointments.reduce((acc, app) => {
            acc[app.status] = (acc[app.status] || 0) + 1;
            return acc;
        }, {});
        
        const chartData = Object.keys(statusCounts).map(status => ({
            name: status.charAt(0).toUpperCase() + status.slice(1),
            population: statusCounts[status],
            color: status === 'pending' ? '#ff9800' : status === 'completed' ? '#4caf50' : status === 'cancelled' ? '#f44336' : '#2196f3',
            legendFontColor: "#7F7F7F",
            legendFontSize: 12
        }));
        
        res.json(chartData);
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch status data" });
    }
});

// 3. Top 5 Vendors by Appointment Volume (Bar Chart)
router.get('/super/top-vendors', async (req, res) => {
    try {
        const appointments = await db.getAllAppointments();
        const vendors = await db.getVendors(false);

        const vendorCounts = appointments.reduce((acc, app) => {
            acc[app.vendor_id] = (acc[app.vendor_id] || 0) + 1;
            return acc;
        }, {});
        
        const sortedVendors = Object.entries(vendorCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5);
            
        const labels = [];
        const data = [];
        
        sortedVendors.forEach(([vendorId, count]) => {
            const vendor = vendors.find(v => v.id === vendorId);
            if (vendor) {
                labels.push(vendor.shop_name.substring(0, 10)); // Truncate name
                data.push(count);
            }
        });
        
        res.json({
            labels,
            datasets: [{ data }]
        });
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch top vendors" });
    }
});

// 4. User Growth (Line Chart - Flexible Range)
router.get('/super/user-growth', async (req, res) => {
    try {
        const users = await db.getUsers();
        const { range, startDate, endDate, date } = req.query;
        
        let labels = [];
        let counts = [];
        
        if (range === 'today') {
            const targetDate = date || new Date().toISOString().split('T')[0];
            for (let i = 0; i < 24; i++) {
                labels.push(`${i}:00`);
            }
            
            counts = labels.map((_, hour) => {
                const limitTime = new Date(`${targetDate}T${String(hour).padStart(2, '0')}:59:59`);
                return users.filter(u => {
                    if (!u.created_at) return true;
                    return new Date(u.created_at) <= limitTime;
                }).length;
            });
            
        } else {
            let start, end;
            if (range === 'custom' && startDate && endDate) {
                start = new Date(startDate);
                end = new Date(endDate);
            } else if (range === 'month') {
                end = new Date();
                start = new Date();
                start.setDate(end.getDate() - 29); // 30 days
            } else {
                end = new Date();
                start = new Date();
                start.setDate(end.getDate() - 6);
            }
            
            let current = new Date(start);
            let safety = 0;
            while (current <= end && safety < 366) {
                const month = current.toLocaleString('en-US', { month: 'short' });
                const day = current.getDate();
                labels.push(`${month} ${day}`);
                
                const dateStr = current.toISOString().split('T')[0];
                const count = users.filter(u => {
                    if (!u.created_at) return true;
                    return new Date(u.created_at) <= new Date(dateStr + 'T23:59:59');
                }).length;
                counts.push(count);
                
                current.setDate(current.getDate() + 1);
                safety++;
            }
        }
        
        res.json({
            labels,
            datasets: [{ data: counts }]
        });
    } catch (e) {
        console.error("User Growth Error:", e);
        res.status(500).json({ error: "Failed to fetch user growth" });
    }
});

// 5. Global Activity Over Time (Appointments, Orders, Revenue)
router.get('/super/activity-over-time', async (req, res) => {
    try {
        const { range, startDate, endDate, date } = req.query; 
        
        const apps = await db.getAllAppointments();
        const orders = await db.getAllOrders();

        let labels = [];
        let appCounts = [];
        let orderCounts = [];
        let revenueData = [];

        if (range === 'today') {
            const targetDate = date || new Date().toISOString().split('T')[0];
            for (let i = 0; i < 24; i++) {
                labels.push(`${i}:00`);
            }
            
            // Appointments
            appCounts = labels.map((_, hour) => {
                return apps.filter(a => {
                    const aDateStr = typeof a.date === 'string' ? a.date : a.date.toISOString().split('T')[0];
                    if (aDateStr !== targetDate) return false;
                    let appHour;
                    if (typeof a.time === 'string') {
                        appHour = parseInt(a.time.split(':')[0]);
                    } else if (a.time instanceof Date) {
                        appHour = a.time.getHours();
                    } else {
                        return false;
                    }
                    return appHour === hour;
                }).length;
            });

            // Orders
            orderCounts = labels.map((_, hour) => {
                return orders.filter(o => {
                    if (!o.created_at) return false;
                    const oDate = new Date(o.created_at);
                    const oDateStr = oDate.toISOString().split('T')[0];
                    if (oDateStr !== targetDate) return false;
                    return oDate.getHours() === hour;
                }).length;
            });

            // Revenue
            revenueData = labels.map((_, hour) => {
                 return orders.filter(o => {
                    if (!o.created_at) return false;
                    const oDate = new Date(o.created_at);
                    const oDateStr = oDate.toISOString().split('T')[0];
                    if (oDateStr !== targetDate) return false;
                    return oDate.getHours() === hour;
                }).reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
            });
            
        } else {
            let start, end;
            if (range === 'custom' && startDate && endDate) {
                start = new Date(startDate);
                end = new Date(endDate);
            } else if (range === 'month') {
                end = new Date();
                start = new Date();
                start.setDate(end.getDate() - 29);
            } else {
                end = new Date();
                start = new Date();
                start.setDate(end.getDate() - 6);
            }
            
            const days = [];
            let current = new Date(start);
            let safety = 0;
            while (current <= end && safety < 366) {
                days.push(current.toISOString().split('T')[0]);
                current.setDate(current.getDate() + 1);
                safety++;
            }
            
            labels = days.map(d => {
                const dateObj = new Date(d);
                return `${dateObj.getDate()}/${dateObj.getMonth()+1}`;
            });
            
            // Apps
            appCounts = days.map(dayStr => {
                return apps.filter(a => {
                    const aDateStr = typeof a.date === 'string' ? a.date : a.date.toISOString().split('T')[0];
                    return aDateStr === dayStr;
                }).length;
            });

            // Orders
            orderCounts = days.map(dayStr => {
                return orders.filter(o => {
                    if (!o.created_at) return false;
                    const oDateStr = new Date(o.created_at).toISOString().split('T')[0];
                    return oDateStr === dayStr;
                }).length;
            });

            // Revenue
            revenueData = days.map(dayStr => {
                return orders.filter(o => {
                    if (!o.created_at) return false;
                    const oDateStr = new Date(o.created_at).toISOString().split('T')[0];
                    return oDateStr === dayStr;
                }).reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
            });
        }

        res.json({
            labels,
            appointments: appCounts,
            orders: orderCounts,
            revenue: revenueData
        });
    } catch (e) {
        console.error("Super Activity Error:", e);
        res.status(500).json({ error: "Failed to fetch super activity data" });
    }
});

// 6. Global Top Locations
router.get('/super/top-locations', async (req, res) => {
    try {
        const apps = await db.getAllAppointments();
        const users = await db.getUsers();
        
        const locationCounts = {};
        
        apps.forEach(app => {
            const user = users.find(u => u.id === app.user_id);
            if (user && user.location_name) {
                const loc = user.location_name.trim();
                if (loc) {
                    locationCounts[loc] = (locationCounts[loc] || 0) + 1;
                }
            }
        });
        
        const sorted = Object.entries(locationCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5);
            
        res.json({
            labels: sorted.map(([k]) => k),
            datasets: [{ data: sorted.map(([, v]) => v) }]
        });
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch top locations" });
    }
});

// --- VENDOR ANALYTICS ---

// 1. Vendor Overview
router.get('/vendor/:vendorId/overview', async (req, res) => {
    try {
        const { vendorId } = req.params;
        const myApps = await db.getAppointmentsByVendor(vendorId);
        const myProducts = await db.getProductsByVendor(vendorId);
        
        const vendor = await db.getVendorById(vendorId);
        let myOrders = [];
        if (vendor) {
            const allOrders = await db.getOrdersByVendorOwner(vendor.owner_id);
            myOrders = allOrders.filter(o => o.vendor_id === vendorId);
        }
        
        const totalRevenue = myOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
        
        res.json({
            appointments: myApps.length,
            products: myProducts.length,
            orders: myOrders.length,
            revenue: totalRevenue
        });
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch vendor overview" });
    }
});

// 2. Appointments by Status (Pie)
router.get('/vendor/:vendorId/appointments-status', async (req, res) => {
    try {
        const { vendorId } = req.params;
        const myApps = await db.getAppointmentsByVendor(vendorId);
        
        const statusCounts = myApps.reduce((acc, app) => {
            acc[app.status] = (acc[app.status] || 0) + 1;
            return acc;
        }, {});
        
        const chartData = Object.keys(statusCounts).map(status => ({
            name: status.charAt(0).toUpperCase() + status.slice(1),
            population: statusCounts[status],
            color: status === 'pending' ? '#ff9800' : status === 'completed' ? '#4caf50' : status === 'cancelled' ? '#f44336' : '#2196f3',
            legendFontColor: "#7F7F7F",
            legendFontSize: 12
        }));
        
        res.json(chartData);
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch status data" });
    }
});

// 3. Activity Over Time (Appointments, Orders, Revenue)
router.get('/vendor/:vendorId/activity-over-time', async (req, res) => {
    try {
        const { vendorId } = req.params;
        const { range, startDate, endDate, date } = req.query; 
        
        const apps = await db.getAppointmentsByVendor(vendorId);
        
        // Orders
        const vendor = await db.getVendorById(vendorId);
        let myOrders = [];
        if (vendor) {
            const allOrders = await db.getOrdersByVendorOwner(vendor.owner_id);
            myOrders = allOrders.filter(o => o.vendor_id === vendorId);
        }

        let labels = [];
        let appCounts = [];
        let orderCounts = [];
        let revenueData = [];

        if (range === 'today') {
            const targetDate = date || new Date().toISOString().split('T')[0];
            for (let i = 0; i < 24; i++) {
                labels.push(`${i}:00`);
            }
            
            // Appointments
            appCounts = labels.map((_, hour) => {
                return apps.filter(a => {
                    const aDateStr = typeof a.date === 'string' ? a.date : a.date.toISOString().split('T')[0];
                    if (aDateStr !== targetDate) return false;
                    let appHour;
                    if (typeof a.time === 'string') {
                        appHour = parseInt(a.time.split(':')[0]);
                    } else if (a.time instanceof Date) {
                        appHour = a.time.getHours();
                    } else {
                        return false;
                    }
                    return appHour === hour;
                }).length;
            });

            // Orders
            orderCounts = labels.map((_, hour) => {
                return myOrders.filter(o => {
                    if (!o.created_at) return false;
                    const oDate = new Date(o.created_at);
                    const oDateStr = oDate.toISOString().split('T')[0];
                    if (oDateStr !== targetDate) return false;
                    return oDate.getHours() === hour;
                }).length;
            });

            // Revenue
            revenueData = labels.map((_, hour) => {
                 return myOrders.filter(o => {
                    if (!o.created_at) return false;
                    const oDate = new Date(o.created_at);
                    const oDateStr = oDate.toISOString().split('T')[0];
                    if (oDateStr !== targetDate) return false;
                    return oDate.getHours() === hour;
                }).reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
            });
            
        } else {
            let start, end;
            if (range === 'custom' && startDate && endDate) {
                start = new Date(startDate);
                end = new Date(endDate);
            } else if (range === 'month') {
                end = new Date();
                start = new Date();
                start.setDate(end.getDate() - 29);
            } else {
                end = new Date();
                start = new Date();
                start.setDate(end.getDate() - 6);
            }
            
            const days = [];
            let current = new Date(start);
            let safety = 0;
            while (current <= end && safety < 366) {
                days.push(current.toISOString().split('T')[0]);
                current.setDate(current.getDate() + 1);
                safety++;
            }
            
            labels = days.map(d => {
                const dateObj = new Date(d);
                return `${dateObj.getDate()}/${dateObj.getMonth()+1}`;
            });
            
            // Appointments
            appCounts = days.map(dayStr => {
                return apps.filter(a => {
                    const aDateStr = typeof a.date === 'string' ? a.date : a.date.toISOString().split('T')[0];
                    return aDateStr === dayStr;
                }).length;
            });

            // Orders
            orderCounts = days.map(dayStr => {
                return myOrders.filter(o => {
                    if (!o.created_at) return false;
                    const oDateStr = new Date(o.created_at).toISOString().split('T')[0];
                    return oDateStr === dayStr;
                }).length;
            });

            // Revenue
            revenueData = days.map(dayStr => {
                return myOrders.filter(o => {
                    if (!o.created_at) return false;
                    const oDateStr = new Date(o.created_at).toISOString().split('T')[0];
                    return oDateStr === dayStr;
                }).reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
            });
        }

        res.json({
            labels,
            appointments: appCounts,
            orders: orderCounts,
            revenue: revenueData
        });
    } catch (e) {
        console.error("Activity Error:", e);
        res.status(500).json({ error: "Failed to fetch activity data" });
    }
});

// 4. Top User Locations (For Heat Map visualization)
router.get('/vendor/:vendorId/top-locations', async (req, res) => {
    try {
        const { vendorId } = req.params;
        const apps = await db.getAppointmentsByVendor(vendorId);
        const users = await db.getUsers();
        
        const locationCounts = {};
        
        apps.forEach(app => {
            const user = users.find(u => u.id === app.user_id);
            if (user && user.location_name) {
                const loc = user.location_name.trim();
                if (loc) {
                    locationCounts[loc] = (locationCounts[loc] || 0) + 1;
                }
            }
        });
        
        const sorted = Object.entries(locationCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5);
            
        res.json({
            labels: sorted.map(([k]) => k),
            datasets: [{ data: sorted.map(([, v]) => v) }]
        });
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch top locations" });
    }
});

module.exports = router;
