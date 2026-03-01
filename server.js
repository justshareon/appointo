const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const otpService = require('./otpService');
const db = require('./database');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});
const DEFAULT_PRODUCT_IMAGE = 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?w=800';

app.use(cors());
app.use(express.json());

// Root route for health check
app.get('/', (req, res) => {
    res.json({ 
        status: "alive", 
        mode: db.getType(),
        database: process.env.DB_HOST || 'local'
    });
});

// --- LOGGING UTILITY ---
const LOG = {
    error: (msg, detail = "") => {
        const errorMsg = `[ERROR] ${new Date().toLocaleTimeString()} | ${msg} | ${detail}`;
        console.error("\x1b[31m%s\x1b[0m", errorMsg);
    },
    info: (msg) => {
        const infoMsg = `[INFO] ${new Date().toLocaleTimeString()} | ${msg}`;
        console.log("\x1b[36m%s\x1b[0m", infoMsg);
    },
    success: (msg) => {
        const successMsg = `[SUCCESS] ${new Date().toLocaleTimeString()} | ${msg}`;
        console.log("\x1b[32m%s\x1b[0m", successMsg);
    },
    warning: (msg) => {
        const warnMsg = `[WARN] ${new Date().toLocaleTimeString()} | ${msg}`;
        console.log("\x1b[33m%s\x1b[0m", warnMsg);
    }
};

// Log all incoming requests
app.use((req, res, next) => {
    LOG.info(`Incoming Request: ${req.method} ${req.url}`);
    next();
});

// Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        LOG.error("Access Denied", "No Authorization token provided");
        return res.sendStatus(401);
    }

    jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, user) => {
        if (err) {
            LOG.error("Token Verification Failed", `${err.message} (Secret: ${process.env.JWT_SECRET ? 'Env Set' : 'Default/Fallback'})`);
            return res.sendStatus(403);
        }
        req.user = user;
        next();
    });
};

// Real-time communication
io.on('connection', (socket) => {
    LOG.info(`New client connected: ${socket.id}`);
    socket.on('join_vendor_room', (vendorId) => {
        socket.join(`vendor_${vendorId}`);
        LOG.success(`Socket joined vendor room: ${vendorId}`);
    });
    socket.on('disconnect', () => {
        LOG.warning(`Client disconnected: ${socket.id}`);
    });
});

// --- AUTH ROUTES ---

app.post('/api/auth/send-otp', async (req, res) => {
    let { mobile } = req.body;
    if (!mobile) return res.status(400).json({ error: "Mobile number is required" });
    
    // Normalize mobile: remove spaces, dashes, +91 etc.
    mobile = mobile.toString().replace(/\D/g, '').slice(-10);
    
    if (mobile.length < 10) {
        LOG.error("OTP send failed: Invalid mobile", mobile);
        return res.status(400).json({ error: "Invalid mobile number. Please enter 10 digits." });
    }

    try {
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        const expiresAt = Date.now() + 5 * 60 * 1000;
        
        await db.addOtp({ mobile, otp, expires_at: expiresAt, created_at: new Date() });
        
        LOG.info(`Generated OTP ${otp} for ${mobile}`);
        
        const result = await otpService.sendOTP(mobile, otp);
        if (!result.success) {
            LOG.error(`OTP delivery failed for ${mobile}`, result.error);
            return res.status(500).json({ error: "OTP delivery failed", detail: result.error });
        }
        
        const responsePayload = { success: true, channel: result.channel };
        if (result.channel === 'console') {
            responsePayload.debugOtp = otp;
        }
        res.json(responsePayload);
    } catch (err) { 
        LOG.error("Server Error in /send-otp", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/auth/verify-otp', async (req, res) => {
    let { mobile, otp } = req.body;
    if (!mobile || !otp) return res.status(400).json({ error: "Mobile and OTP are required" });

    // Normalize
    mobile = mobile.toString().replace(/\D/g, '').slice(-10);
    otp = otp.toString().trim();

    LOG.info(`Verification attempt for ${mobile} with code ${otp}`);

    try {
        const validOtp = await db.getValidOtp(mobile, otp);
        if (!validOtp) {
            LOG.error("Verification failed", `Invalid/Expired code ${otp} for ${mobile}`);
            return res.status(401).json({ error: "Invalid or expired OTP" });
        }

        await db.deleteOtpsByMobile(mobile);
        LOG.success(`OTP verified for ${mobile}`);

        // Search user by normalized mobile
        const user = await db.getUserByMobile(mobile);
        if (user) {
            const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET || 'secret');
            LOG.success(`User logged in: ${user.name}`);
            res.json({ success: true, isNewUser: false, token, user });
        } else {
            res.json({ success: true, isNewUser: true, mobile });
        }
    } catch (err) { 
        LOG.error("Server Error in /verify-otp", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        let { name, email, mobile, location_name, role } = req.body;
        
        // Normalize mobile
        if (mobile) mobile = mobile.toString().replace(/\D/g, '').slice(-10);

        const userId = 'usr_' + Math.random().toString(36).substring(2, 11);
        const newUser = { id: userId, name, email, mobile, location_name, role: role || 'user', created_at: new Date() };
        
        await db.addUser(newUser);
        const token = jwt.sign({ id: userId, role: newUser.role }, process.env.JWT_SECRET || 'secret');
        
        LOG.success(`New user registered: ${email}`);
        res.json({ token, user: newUser });
    } catch (err) { 
        LOG.error("Server Error in /register", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/auth/update-role', authenticateToken, async (req, res) => {
    try {
        await db.updateUserRole(req.user.id, req.body.role);
        LOG.info(`Role updated for user ${req.user.id}`);
        res.json({ success: true });
    } catch (err) { 
        LOG.error("Server Error in /update-role", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/auth/update-profile', authenticateToken, async (req, res) => {
    try {
        const { name, email, location_name } = req.body;
        
        // 1. If email is provided, check if it's already taken by ANOTHER user
        if (email) {
            const existing = await db.getUserByEmail(email);
            if (existing && existing.id !== req.user.id) {
                LOG.error("Profile update conflict", `Email ${email} already used by ${existing.id}`);
                return res.status(400).json({ error: "This email address is already registered with another account." });
            }
        }

        // 2. Proceed with update
        await db.updateUserProfile(req.user.id, { name, email, location_name });
        
        const updated = await db.getUserById(req.user.id);
        LOG.success(`Profile updated for user: ${updated.email}`);
        res.json({ success: true, user: updated });
    } catch (err) {
        LOG.error("Server Error in /update-profile", err.message);
        res.status(500).json({ error: "Internal server error during profile update." });
    }
});

// --- VENDOR & QUEUE ROUTES ---

app.get('/api/vendors', async (req, res) => {
    try {
        const vendors = await db.getVendors(true);
        
        // If user is logged in (optional auth), mark which ones they've joined
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        let userId = null;
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
                userId = decoded.id;
            } catch (e) {}
        }

        if (userId) {
            const history = await db.getUserHistory(userId);
            const activeQueueVendorIds = history
                .filter(h => h.status === 'waiting')
                .map(h => h.vendor_id);
            
            const enriched = vendors.map(v => ({
                ...v,
                is_joined: activeQueueVendorIds.includes(v.id)
            }));
            return res.json(enriched);
        }

        res.json(vendors);
    } catch (err) { 
        LOG.error("Failed to fetch vendors", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

app.get('/api/vendors/me', authenticateToken, async (req, res) => {
    try {
        const vendor = await db.getVendorByOwnerId(req.user.id);
        res.json(vendor || {});
    } catch (err) { 
        LOG.error("Failed to fetch vendor profile", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/vendors/create-my-shop', authenticateToken, async (req, res) => {
    try {
        const user = await db.getUserById(req.user.id);
        if (!user) {
            LOG.error('Failed to create vendor profile', `User not found for token id: ${req.user.id}`);
            return res.status(404).json({ error: 'User not found. Please login again.' });
        }

        const existing = await db.getVendorByOwnerId(req.user.id);
        if (existing) {
            return res.json({ success: true, vendor: existing, created: false });
        }

        const shopName = req.body.shop_name || `${user?.name || 'My'} Shop`;
        const vendor = {
            id: 'v_' + Math.random().toString(36).substring(2, 10),
            owner_id: req.user.id,
            shop_name: shopName,
            category: req.body.category || 'General',
            is_active: true,
            is_promoted: false,
            latitude: 0,
            longitude: 0
        };
        await db.addVendor(vendor);
        LOG.success(`Vendor profile created for user ${req.user.id}`);
        res.json({ success: true, vendor, created: true });
    } catch (err) {
        LOG.error('Failed to create vendor profile', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/vendors/update-my-profile', authenticateToken, async (req, res) => {
    try {
        const vendor = await db.getVendorByOwnerId(req.user.id);
        if (!vendor) {
            return res.status(404).json({ error: 'Vendor profile not found' });
        }

        const allowedFields = ['shop_name', 'category', 'google_link', 'instagram_handle', 'facebook_link', 'features_products', 'features_payments', 'features_appointments'];
        for (const field of allowedFields) {
            if (Object.prototype.hasOwnProperty.call(req.body, field)) {
                await db.updateVendor(vendor.id, field, req.body[field]);
            }
        }
        const updated = await db.getVendorByOwnerId(req.user.id);
        res.json({ success: true, vendor: updated });
    } catch (err) {
        LOG.error('Failed to update vendor profile', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/vendors/:id/queue', async (req, res) => {
    try {
        const queue = await db.getQueueByVendor(req.params.id);
        res.json(queue);
    } catch (err) { 
        LOG.error("Failed to fetch queue", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

app.get('/api/vendors/:id/products', async (req, res) => {
    try {
        const vendor = await db.getVendorById(req.params.id);
        if (!vendor || vendor.features_products === false) {
            return res.json([]);
        }
        const products = await db.getProductsByVendor(req.params.id);
        res.json(products || []);
    } catch (err) {
        LOG.error("Failed to fetch vendor products", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/products', async (req, res) => {
    try {
        const products = await db.getAllProductsWithVendors();
        res.json(products || []);
    } catch (err) {
        LOG.error("Failed to fetch products", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        const product = await db.getProductById(req.params.id);
        if (!product) return res.status(404).json({ error: "Product not found" });
        const vendor = await db.getVendorById(product.vendor_id);
        if (!vendor || vendor.features_products === false) return res.status(404).json({ error: "Product not available" });
        res.json({
            ...product,
            shop_name: vendor.shop_name
        });
    } catch (err) {
        LOG.error("Failed to fetch product details", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/vendors/me/products', authenticateToken, async (req, res) => {
    try {
        const vendor = await db.getVendorByOwnerId(req.user.id);
        if (!vendor) return res.json([]);
        const products = await db.getProductsByVendor(vendor.id);
        res.json(products || []);
    } catch (err) {
        LOG.error("Failed to fetch own products", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/vendors/me/appointments', authenticateToken, async (req, res) => {
    try {
        const vendor = await db.getVendorByOwnerId(req.user.id);
        if (!vendor) return res.json([]);
        
        // Return appointments for ALL vendors owned by this user
        const ownedVendors = await db.getVendors(false);
        const myVendorIds = ownedVendors.filter(v => v.owner_id === req.user.id).map(v => v.id);
        
        let allAppointments = [];
        for (const vId of myVendorIds) {
            const apps = await db.getAppointmentsByVendor(vId);
            allAppointments = [...allAppointments, ...apps];
        }
        
        res.json(allAppointments || []);
    } catch (err) {
        LOG.error("Failed to fetch vendor appointments", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/vendors/me/products/add', authenticateToken, async (req, res) => {
    try {
        let vendor = await db.getVendorByOwnerId(req.user.id);
        
        // AUTO-CREATE VENDOR PROFILE IF MISSING
        if (!vendor) {
            LOG.warning(`No vendor profile found for user ${req.user.id}. Creating default...`);
            const user = await db.getUserById(req.user.id);
            vendor = {
                id: 'v_' + Math.random().toString(36).substring(2, 10),
                owner_id: req.user.id,
                shop_name: user?.name ? `${user.name}'s Shop` : "My New Shop",
                category: 'General',
                is_active: true,
                is_promoted: false,
                latitude: 0,
                longitude: 0
            };
            await db.addVendor(vendor);
            LOG.success(`Auto-created vendor profile: ${vendor.id}`);
        }

        const { name, price, offer, offer_amount, validity_from, validity_to, description, image_urls } = req.body;
        if (!name || !price) return res.status(400).json({ error: "name and price are required" });
        
        const normalizedImages = Array.isArray(image_urls) ? image_urls.filter(Boolean) : [];
        const finalImages = normalizedImages.length ? normalizedImages : [DEFAULT_PRODUCT_IMAGE];
        
        const product = {
            vendor_id: vendor.id, // Explicitly mapped to the vendor we found/created
            name,
            price: Number(price),
            offer: offer || '',
            offer_amount: Number(offer_amount || 0),
            validity_from: validity_from || null,
            validity_to: validity_to || null,
            description: description || '',
            image_urls: finalImages,
            category: vendor.category || 'General',
            stock: 100
        };
        
        const added = await db.addProduct(product);
        LOG.success(`Product added to vendor ${vendor.id}: ${name}`);
        res.json({ success: true, product: added });
    } catch (err) {
        LOG.error("Failed to add product", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/vendors/me/products/:id/update', authenticateToken, async (req, res) => {
    try {
        const vendor = await db.getVendorByOwnerId(req.user.id);
        if (!vendor) return res.status(404).json({ error: "Vendor profile not found" });
        const existing = await db.getProductById(req.params.id);
        if (!existing || existing.vendor_id !== vendor.id) {
            return res.status(404).json({ error: "Product not found for this vendor" });
        }

        const updateData = {};
        const fields = ['name', 'price', 'offer', 'offer_amount', 'validity_from', 'validity_to', 'description', 'image_urls', 'stock'];
        fields.forEach((f) => {
            if (Object.prototype.hasOwnProperty.call(req.body, f)) updateData[f] = req.body[f];
        });

        // Keep first/default image fixed; only allow editing images after index 0.
        if (Object.prototype.hasOwnProperty.call(updateData, 'image_urls')) {
            const existingImages = Array.isArray(existing.image_urls) ? existing.image_urls.filter(Boolean) : [];
            const fixedFirstImage = existingImages[0] || DEFAULT_PRODUCT_IMAGE;
            const incoming = Array.isArray(updateData.image_urls) ? updateData.image_urls.filter(Boolean) : [];
            const extras = incoming.filter((u) => u && u !== fixedFirstImage);
            updateData.image_urls = [fixedFirstImage, ...extras];
        }

        const updated = await db.updateProduct(req.params.id, updateData);
        res.json({ success: true, product: updated });
    } catch (err) {
        LOG.error("Failed to update product", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/queue/join', authenticateToken, async (req, res) => {
    try {
        const { vendor_id } = req.body;

        // 1. Parallelize checks to reduce latency
        const [vendor, existing] = await Promise.all([
            db.getVendorById(vendor_id),
            db.getQueueByVendor(vendor_id)
        ]);

        if (vendor && vendor.owner_id === req.user.id) {
            return res.status(403).json({ error: "You cannot join the queue of your own shop." });
        }

        const alreadyIn = existing.some(q => q.user_id === req.user.id);
        if (alreadyIn) {
            return res.json({ success: true, alreadyIn: true });
        }

        // 2. Perform write
        await db.addQueueItem({
            vendor_id,
            user_id: req.user.id,
            status: "waiting",
            joined_at: new Date()
        });
        
        // 3. Respond immediately to the user
        res.json({ success: true });

        // 4. Update the room in background
        db.getQueueByVendor(vendor_id).then(updatedQueue => {
            io.to(`vendor_${vendor_id}`).emit('queue_updated', updatedQueue);
        }).catch(e => LOG.error("Background queue update failed", e.message));
        
        LOG.success(`User ${req.user.id} joined queue ${vendor_id}`);
    } catch (err) { 
        LOG.error("Failed to join queue", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/queue/leave', authenticateToken, async (req, res) => {
    try {
        const { vendor_id } = req.body;
        
        // Respond immediately after the delete operation
        const removed = await db.removeQueueItem(req.user.id, vendor_id);
        res.json({ success: true, removed });

        if (removed) {
            // Re-fetch and emit in background
            db.getQueueByVendor(vendor_id).then(updatedQueue => {
                io.to(`vendor_${vendor_id}`).emit('queue_updated', updatedQueue);
            }).catch(e => LOG.error("Background queue update failed", e.message));
            LOG.success(`User ${req.user.id} left queue ${vendor_id}`);
        }
    } catch (err) {
        LOG.error("Failed to leave queue", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/queue/update-status', authenticateToken, async (req, res) => {
    try {
        const vId = await db.updateQueueStatus(req.body.queue_id, req.body.status);
        if (vId) {
            const updatedQueue = await db.getQueueByVendor(vId);
            io.to(`vendor_${vId}`).emit('queue_updated', updatedQueue);
        }
        res.json({ success: true });
    } catch (err) { 
        LOG.error("Failed to update status", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

// --- HISTORY & APPOINTMENTS ---

app.get('/api/history/user', authenticateToken, async (req, res) => {
    try {
        const history = await db.getUserHistory(req.user.id);
        res.json(history || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/history/vendor', authenticateToken, async (req, res) => {
    try {
        const vendor = await db.getVendorByOwnerId(req.user.id);
        if (!vendor) return res.json([]);
        const history = await db.getVendorHistory(vendor.id);
        res.json(history);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/appointments/me', authenticateToken, async (req, res) => {
    try {
        const apps = await db.getAppointmentsByUser(req.user.id);
        res.json(apps || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/appointments/book', authenticateToken, async (req, res) => {
    try {
        const { vendor_id } = req.body;

        // CHECK OWNERSHIP: Vendor cannot book appointment with their own shop
        const vendor = await db.getVendorById(vendor_id);
        if (vendor && vendor.owner_id === req.user.id) {
            return res.status(403).json({ error: "You cannot book an appointment with your own shop." });
        }

        await db.addAppointment({
            vendor_id,
            user_id: req.user.id,
            date: req.body.date,
            time: req.body.time,
            status: 'pending',
            created_at: new Date()
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/appointments/update-status', authenticateToken, async (req, res) => {
    try {
        const { appointment_id, status } = req.body;
        await db.updateAppointmentStatus(appointment_id, status);
        res.json({ success: true });
    } catch (err) {
        LOG.error("Failed to update appointment status", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/orders/create', authenticateToken, async (req, res) => {
    try {
        const { vendor_id, items, total_amount, payment_gateway, payment_ref } = req.body;
        if (!vendor_id || !Array.isArray(items) || !items.length) {
            return res.status(400).json({ error: "vendor_id and items are required" });
        }
        const vendor = await db.getVendorById(vendor_id);
        if (!vendor) return res.status(404).json({ error: "Vendor not found" });
        if (vendor.features_payments === false) {
            return res.status(403).json({ error: "Payments are disabled for this vendor" });
        }
        const order = {
            vendor_id,
            user_id: req.user.id,
            total_amount: Number(total_amount || 0),
            payment_gateway: payment_gateway || 'unknown',
            payment_ref: payment_ref || '',
            status: 'paid',
            items_json: JSON.stringify(items),
            created_at: new Date()
        };
        await db.addOrder(order);
        res.json({ success: true });
    } catch (err) {
        LOG.error("Failed to create order", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/orders/vendor', authenticateToken, async (req, res) => {
    try {
        const rows = await db.getOrdersByVendorOwner(req.user.id);
        res.json(rows || []);
    } catch (err) {
        LOG.error("Failed to fetch vendor orders", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/activities', async (req, res) => {
    try {
        const activities = await db.getActivities();
        res.json(activities);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ADMIN ---
app.get('/api/admin/vendors', authenticateToken, async (req, res) => {
    if (req.user.role !== 'super_admin') return res.sendStatus(403);
    try {
        const vendors = await db.getVendors(false);
        res.json(vendors);
    } catch (err) {
        LOG.error("Admin fetch vendors failed", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/update-vendor', authenticateToken, async (req, res) => {
    if (req.user.role !== 'super_admin') return res.sendStatus(403);
    try {
        await db.updateVendor(req.body.vendorId, req.body.field, req.body.value);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/add-vendor', authenticateToken, async (req, res) => {
    if (req.user.role !== 'super_admin') return res.sendStatus(403);
    try {
        const { shop_name, category, owner_mobile, owner_name, owner_email } = req.body;
        if (!shop_name || !owner_mobile) {
            return res.status(400).json({ error: 'shop_name and owner_mobile are required' });
        }

        let owner = await db.getUserByMobile(owner_mobile);
        if (!owner) {
            const ownerId = 'usr_' + Math.random().toString(36).substring(2, 11);
            owner = {
                id: ownerId,
                name: owner_name || 'Vendor Owner',
                email: owner_email || `vendor_${owner_mobile}@qrqueue.local`,
                mobile: owner_mobile,
                role: 'vendor',
                created_at: new Date()
            };
            await db.addUser(owner);
        } else if (owner.role !== 'vendor') {
            await db.updateUserRole(owner.id, 'vendor');
            owner.role = 'vendor';
        }

        const vendor = {
            id: 'v_' + Math.random().toString(36).substring(2, 10),
            owner_id: owner.id,
            shop_name,
            category: category || 'General',
            is_active: true,
            is_promoted: false,
            latitude: 0,
            longitude: 0
        };

        await db.addVendor(vendor);
        LOG.success(`Admin added vendor ${vendor.shop_name} for mobile ${owner_mobile}`);
        res.json({ success: true, vendor, owner });
    } catch (err) {
        LOG.error('Failed to add vendor', err.message);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log("\n========================================");
    LOG.success(`QR Queue Server Started [Mode: ${db.getType().toUpperCase()}]`);
    LOG.info(`Listening on: http://localhost:${PORT}`);
    LOG.info(`DB Methods available: ${Object.keys(db).join(', ')}`);
    if (db.getType() === 'inmemory') {
        LOG.info(`Seed Users -> Super Admin: 9999999999 | Vendor: 8888888888 | User: 7777777777`);
    }
    console.log("========================================\n");
});
