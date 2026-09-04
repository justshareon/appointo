/**
 * Seed Trust Score Data
 * Creates trust1 and trustvendor1 users and sample data for all Trust Score screens
 * First saves to in-memory database, then can be synced to MySQL
 */

const db = require('./database');
const LOG = require('./utils/logger');

// Get direct access to in-memory database
const getInMemoryDb = () => {
    // Access the in-memory database directly
    return db.users ? { users: db.users, vendors: db.vendors } : null;
};

async function seedTrustScoreData() {
    console.log('\n=== Seeding Trust Score Data ===\n');

    try {
        // 1. Create Users
        console.log('1. Creating users...');
        
        const trustUser = {
            id: 'usr_trust1',
            name: 'Trust User 1',
            email: 'trust1@test.com',
            mobile: '8000000101',
            role: 'user',
            location_name: 'Mumbai',
            password: 'trust123', // In production, this should be hashed
            created_at: new Date()
        };

        const trustVendor = {
            id: 'usr_trustvendor1',
            name: 'Trust Vendor 1',
            email: 'trustvendor1@test.com',
            mobile: '8000000102',
            role: 'vendor',
            location_name: 'Mumbai',
            password: 'trust123',
            created_at: new Date()
        };

        // Add users to database (works for both in-memory and MySQL)
        await db.addUser(trustUser);
        await db.addUser(trustVendor);
        console.log('✓ Created users: trust1, trustvendor1');

        // 2. Create Trust Score Vendor
        console.log('\n2. Creating trust score vendor...');
        
        const trustVendorShop = {
            id: 'v_trust1',
            owner_id: 'usr_trustvendor1',
            shop_name: 'Trust Score Services',
            category: 'Trust Services',
            is_active: true,
            is_promoted: false,
            latitude: 19.1136,
            longitude: 72.8697,
            location_name: 'Mumbai',
            features_trust_score: true,
            visibility_list: true,
            visibility_feed: false,
            visibility_top_rated: false
        };

        await db.addVendor(trustVendorShop);
        console.log('✓ Created trust score vendor: v_trust1');

        // 3. Create Sample Projects (with all 20+ fields)
        console.log('\n3. Creating sample projects...');
        
        const projects = [
            {
                id: 'proj_sunshine',
                name: 'Sunshine Towers',
                reraNumber: 'P52100012345',
                builderName: 'Lodha Group',
                builderId: 'builder_lodha',
                address: 'Andheri East, Mumbai, Maharashtra 400069',
                latitude: 19.1136,
                longitude: 72.8697,
                totalArea: '2,50,000 sq. ft.',
                numberOfFloors: 45,
                numberOfUnits: 320,
                projectStatus: 'Ongoing',
                launchDate: '2020-01-15',
                expectedCompletionDate: '2025-06-30',
                actualCompletionDate: null,
                reraExtensionDetails: 'Extension granted until 2025-12-31',
                landOwnershipTitle: 'Freehold',
                landOwnerName: 'Lodha Developers Pvt. Ltd.',
                landArea: '15,000 sq. m.',
                landId: 'LAND-MUM-001',
                approvalAuthorities: JSON.stringify(['BMC', 'CIDCO', 'RERA Maharashtra']),
                approvedBuildingPlans: 'https://example.com/plans/sunshine.pdf',
                bankName: 'HDFC Bank',
                loanAmountSanctioned: '₹500 Crores',
                totalAmountCollected: '₹1,200 Crores',
                fundingSources: 'Bank Loan + Self-funding',
                litigationHistory: JSON.stringify([
                    { case: 'Land Title Dispute', status: 'Resolved', year: 2021 },
                    { case: 'RERA Complaint', status: 'Pending', year: 2023 }
                ]),
                reraComplaintsCount: 2,
                reraComplaintsStatus: '2 Pending, 0 Resolved',
                trustScore: 92,
                builderScore: 90,
                projectScore: 92,
                completion: 65,
                priceRise: '20%',
                location: 'Mumbai',
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: 'proj_greenfield',
                name: 'Greenfield Estate',
                reraNumber: 'P52100012346',
                builderName: 'Godrej Properties',
                builderId: 'builder_godrej',
                address: 'Powai, Mumbai, Maharashtra 400076',
                latitude: 19.1176,
                longitude: 72.9067,
                totalArea: '3,00,000 sq. ft.',
                numberOfFloors: 50,
                numberOfUnits: 400,
                projectStatus: 'Near Completion',
                launchDate: '2019-05-20',
                expectedCompletionDate: '2024-12-31',
                actualCompletionDate: null,
                reraExtensionDetails: null,
                landOwnershipTitle: 'Leasehold',
                landOwnerName: 'Godrej Properties Ltd.',
                landArea: '18,000 sq. m.',
                landId: 'LAND-MUM-002',
                approvalAuthorities: JSON.stringify(['BMC', 'RERA Maharashtra']),
                approvedBuildingPlans: 'https://example.com/plans/greenfield.pdf',
                bankName: 'ICICI Bank',
                loanAmountSanctioned: '₹600 Crores',
                totalAmountCollected: '₹1,500 Crores',
                fundingSources: 'Bank Loan',
                litigationHistory: JSON.stringify([]),
                reraComplaintsCount: 0,
                reraComplaintsStatus: '0 Complaints',
                trustScore: 95,
                builderScore: 95,
                projectScore: 95,
                completion: 85,
                priceRise: '25%',
                location: 'Mumbai',
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: 'proj_lakeview',
                name: 'Lakeview Homes',
                reraNumber: 'UP123456789',
                builderName: 'DLF Limited',
                builderId: 'builder_dlf',
                address: 'Sector 62, Noida, Uttar Pradesh 201301',
                latitude: 28.6139,
                longitude: 77.2090,
                totalArea: '1,80,000 sq. ft.',
                numberOfFloors: 30,
                numberOfUnits: 200,
                projectStatus: 'Ongoing',
                launchDate: '2021-03-10',
                expectedCompletionDate: '2026-03-31',
                actualCompletionDate: null,
                reraExtensionDetails: null,
                landOwnershipTitle: 'Freehold',
                landOwnerName: 'DLF Limited',
                landArea: '12,000 sq. m.',
                landId: 'LAND-UP-001',
                approvalAuthorities: JSON.stringify(['Noida Authority', 'RERA Uttar Pradesh']),
                approvedBuildingPlans: 'https://example.com/plans/lakeview.pdf',
                bankName: 'SBI',
                loanAmountSanctioned: '₹300 Crores',
                totalAmountCollected: '₹800 Crores',
                fundingSources: 'Bank Loan + Self-funding',
                litigationHistory: JSON.stringify([
                    { case: 'Construction Delay', status: 'Pending', year: 2023 }
                ]),
                reraComplaintsCount: 1,
                reraComplaintsStatus: '1 Pending',
                trustScore: 88,
                builderScore: 88,
                projectScore: 88,
                completion: 45,
                priceRise: '15%',
                location: 'Kanpur',
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: 'proj_bluesapphire',
                name: 'Blue Sapphire',
                reraNumber: 'P52100012347',
                builderName: 'Unknown Builder',
                builderId: 'builder_unknown',
                address: 'Bandra West, Mumbai, Maharashtra 400050',
                latitude: 19.0596,
                longitude: 72.8295,
                totalArea: '1,20,000 sq. ft.',
                numberOfFloors: 25,
                numberOfUnits: 150,
                projectStatus: 'Disputed',
                launchDate: '2018-01-01',
                expectedCompletionDate: '2023-12-31',
                actualCompletionDate: null,
                reraExtensionDetails: null,
                landOwnershipTitle: 'Freehold',
                landOwnerName: 'Multiple Owners',
                landArea: '8,000 sq. m.',
                landId: 'LAND-MUM-003',
                approvalAuthorities: JSON.stringify(['BMC']),
                approvedBuildingPlans: null,
                bankName: null,
                loanAmountSanctioned: null,
                totalAmountCollected: '₹400 Crores',
                fundingSources: 'Self-funding',
                litigationHistory: JSON.stringify([
                    { case: 'Land Sold Twice', status: 'Active', year: 2023 },
                    { case: 'Fraud Complaint', status: 'Active', year: 2023 }
                ]),
                reraComplaintsCount: 5,
                reraComplaintsStatus: '5 Pending, 0 Resolved',
                trustScore: 35,
                builderScore: 30,
                projectScore: 35,
                completion: 30,
                priceRise: '0%',
                location: 'Mumbai',
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: 'proj_riverdale',
                name: 'Riverdale Phase 3',
                reraNumber: 'P52100012348',
                builderName: 'Shapoorji Pallonji',
                builderId: 'builder_shapoorji',
                address: 'Thane, Mumbai, Maharashtra 400601',
                latitude: 19.2183,
                longitude: 72.9781,
                totalArea: '2,20,000 sq. ft.',
                numberOfFloors: 40,
                numberOfUnits: 280,
                projectStatus: 'Ongoing',
                launchDate: '2021-08-10',
                expectedCompletionDate: '2025-12-31',
                actualCompletionDate: null,
                reraExtensionDetails: null,
                landOwnershipTitle: 'Leasehold',
                landOwnerName: 'Shapoorji Pallonji & Co. Ltd.',
                landArea: '14,000 sq. m.',
                landId: 'LAND-MUM-004',
                approvalAuthorities: JSON.stringify(['TMC', 'RERA Maharashtra']),
                approvedBuildingPlans: 'https://example.com/plans/riverdale.pdf',
                bankName: 'Axis Bank',
                loanAmountSanctioned: '₹450 Crores',
                totalAmountCollected: '₹1,100 Crores',
                fundingSources: 'Bank Loan',
                litigationHistory: JSON.stringify([]),
                reraComplaintsCount: 12,
                reraComplaintsStatus: '12 Pending, 0 Resolved',
                trustScore: 75,
                builderScore: 78,
                projectScore: 75,
                completion: 55,
                priceRise: '18%',
                location: 'Mumbai',
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: 'proj_oberoi',
                name: 'Oberoi Woods',
                reraNumber: 'P52100012349',
                builderName: 'Oberoi Realty',
                builderId: 'builder_oberoi',
                address: 'Goregaon East, Mumbai, Maharashtra 400063',
                latitude: 19.1596,
                longitude: 72.8567,
                totalArea: '4,50,000 sq. ft.',
                numberOfFloors: 60,
                numberOfUnits: 500,
                projectStatus: 'Near Completion',
                launchDate: '2018-03-15',
                expectedCompletionDate: '2024-06-30',
                actualCompletionDate: null,
                reraExtensionDetails: null,
                landOwnershipTitle: 'Freehold',
                landOwnerName: 'Oberoi Realty Ltd.',
                landArea: '25,000 sq. m.',
                landId: 'LAND-MUM-005',
                approvalAuthorities: JSON.stringify(['BMC', 'CIDCO', 'RERA Maharashtra']),
                approvedBuildingPlans: 'https://example.com/plans/oberoi.pdf',
                bankName: 'Kotak Mahindra Bank',
                loanAmountSanctioned: '₹800 Crores',
                totalAmountCollected: '₹2,000 Crores',
                fundingSources: 'Bank Loan + Self-funding',
                litigationHistory: JSON.stringify([]),
                reraComplaintsCount: 1,
                reraComplaintsStatus: '1 Resolved',
                trustScore: 93,
                builderScore: 92,
                projectScore: 93,
                completion: 90,
                priceRise: '30%',
                location: 'Mumbai',
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: 'proj_kalpataru',
                name: 'Kalpataru Vista',
                reraNumber: 'P52100012350',
                builderName: 'Kalpataru Group',
                builderId: 'builder_kalpataru',
                address: 'Andheri West, Mumbai, Maharashtra 400053',
                latitude: 19.1364,
                longitude: 72.8296,
                totalArea: '1,90,000 sq. ft.',
                numberOfFloors: 35,
                numberOfUnits: 240,
                projectStatus: 'Ongoing',
                launchDate: '2020-09-20',
                expectedCompletionDate: '2025-09-30',
                actualCompletionDate: null,
                reraExtensionDetails: null,
                landOwnershipTitle: 'Freehold',
                landOwnerName: 'Kalpataru Group',
                landArea: '11,500 sq. m.',
                landId: 'LAND-MUM-006',
                approvalAuthorities: JSON.stringify(['BMC', 'RERA Maharashtra']),
                approvedBuildingPlans: 'https://example.com/plans/kalpataru.pdf',
                bankName: 'HDFC Bank',
                loanAmountSanctioned: '₹380 Crores',
                totalAmountCollected: '₹950 Crores',
                fundingSources: 'Bank Loan',
                litigationHistory: JSON.stringify([
                    { case: 'RERA Complaint', status: 'Resolved', year: 2022 }
                ]),
                reraComplaintsCount: 1,
                reraComplaintsStatus: '0 Pending, 1 Resolved',
                trustScore: 87,
                builderScore: 85,
                projectScore: 87,
                completion: 60,
                priceRise: '22%',
                location: 'Mumbai',
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: 'proj_runwal',
                name: 'Runwal Gardens',
                reraNumber: 'P52100012351',
                builderName: 'Runwal Group',
                builderId: 'builder_runwal',
                address: 'Mulund West, Mumbai, Maharashtra 400080',
                latitude: 19.1715,
                longitude: 72.9560,
                totalArea: '3,20,000 sq. ft.',
                numberOfFloors: 48,
                numberOfUnits: 360,
                projectStatus: 'Ongoing',
                launchDate: '2019-11-05',
                expectedCompletionDate: '2025-03-31',
                actualCompletionDate: null,
                reraExtensionDetails: null,
                landOwnershipTitle: 'Leasehold',
                landOwnerName: 'Runwal Group',
                landArea: '19,000 sq. m.',
                landId: 'LAND-MUM-007',
                approvalAuthorities: JSON.stringify(['BMC', 'RERA Maharashtra']),
                approvedBuildingPlans: 'https://example.com/plans/runwal.pdf',
                bankName: 'ICICI Bank',
                loanAmountSanctioned: '₹550 Crores',
                totalAmountCollected: '₹1,350 Crores',
                fundingSources: 'Bank Loan + Self-funding',
                litigationHistory: JSON.stringify([]),
                reraComplaintsCount: 0,
                reraComplaintsStatus: '0 Complaints',
                trustScore: 89,
                builderScore: 88,
                projectScore: 89,
                completion: 70,
                priceRise: '28%',
                location: 'Mumbai',
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: 'proj_piramal',
                name: 'Piramal Revanta',
                reraNumber: 'P52100012352',
                builderName: 'Piramal Realty',
                builderId: 'builder_piramal',
                address: 'Worli, Mumbai, Maharashtra 400018',
                latitude: 19.0176,
                longitude: 72.8273,
                totalArea: '5,00,000 sq. ft.',
                numberOfFloors: 70,
                numberOfUnits: 600,
                projectStatus: 'Ongoing',
                launchDate: '2022-01-10',
                expectedCompletionDate: '2027-12-31',
                actualCompletionDate: null,
                reraExtensionDetails: null,
                landOwnershipTitle: 'Freehold',
                landOwnerName: 'Piramal Realty Pvt. Ltd.',
                landArea: '30,000 sq. m.',
                landId: 'LAND-MUM-008',
                approvalAuthorities: JSON.stringify(['BMC', 'CIDCO', 'RERA Maharashtra']),
                approvedBuildingPlans: 'https://example.com/plans/piramal.pdf',
                bankName: 'SBI',
                loanAmountSanctioned: '₹1,000 Crores',
                totalAmountCollected: '₹2,500 Crores',
                fundingSources: 'Bank Loan',
                litigationHistory: JSON.stringify([]),
                reraComplaintsCount: 0,
                reraComplaintsStatus: '0 Complaints',
                trustScore: 91,
                builderScore: 90,
                projectScore: 91,
                completion: 40,
                priceRise: '35%',
                location: 'Mumbai',
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: 'proj_wadhwa',
                name: 'Wadhwa Group Estate',
                reraNumber: 'P52100012353',
                builderName: 'Wadhwa Group',
                builderId: 'builder_wadhwa',
                address: 'Kandivali East, Mumbai, Maharashtra 400101',
                latitude: 19.2033,
                longitude: 72.8614,
                totalArea: '2,80,000 sq. ft.',
                numberOfFloors: 42,
                numberOfUnits: 300,
                projectStatus: 'Ongoing',
                launchDate: '2021-06-15',
                expectedCompletionDate: '2026-06-30',
                actualCompletionDate: null,
                reraExtensionDetails: null,
                landOwnershipTitle: 'Freehold',
                landOwnerName: 'Wadhwa Group',
                landArea: '17,000 sq. m.',
                landId: 'LAND-MUM-009',
                approvalAuthorities: JSON.stringify(['BMC', 'RERA Maharashtra']),
                approvedBuildingPlans: 'https://example.com/plans/wadhwa.pdf',
                bankName: 'HDFC Bank',
                loanAmountSanctioned: '₹420 Crores',
                totalAmountCollected: '₹1,050 Crores',
                fundingSources: 'Bank Loan + Self-funding',
                litigationHistory: JSON.stringify([
                    { case: 'Construction Delay', status: 'Pending', year: 2023 }
                ]),
                reraComplaintsCount: 3,
                reraComplaintsStatus: '3 Pending, 0 Resolved',
                trustScore: 82,
                builderScore: 80,
                projectScore: 82,
                completion: 50,
                priceRise: '16%',
                location: 'Mumbai',
                createdAt: new Date(),
                updatedAt: new Date()
            }
        ];

        // Get pool for MySQL or use in-memory
        const pool = db.getPool ? db.getPool() : null;
        const dbType = db.getType ? db.getType() : 'inmemory';
        
        // Initialize in-memory arrays if they don't exist
        if (!db.trustScoreProjects) {
            db.trustScoreProjects = [];
        }

        // Add projects to database (check if exists first)
        let addedCount = 0;
        let skippedCount = 0;
        
        for (const project of projects) {
            // Check if project already exists
            let exists = false;
            
            if (pool) {
                // MySQL: Check if exists
                try {
                    const [rows] = await pool.query('SELECT id FROM trust_score_projects WHERE id = ?', [project.id]);
                    exists = rows && rows.length > 0;
                } catch (err) {
                    // Table might not exist yet, that's okay
                    console.log(`   Note: trust_score_projects table may not exist yet`);
                }
            } else {
                // In-memory: Check if exists
                exists = db.trustScoreProjects.some(p => p.id === project.id);
            }
            
            if (exists) {
                skippedCount++;
                console.log(`   ⏭ Skipped existing project: ${project.name}`);
                continue;
            }
            
            // Add project
            if (pool) {
                // MySQL: Insert
                try {
                    await pool.query(`
                        INSERT INTO trust_score_projects 
                        (id, name, rera_number, builder_name, builder_id, address, latitude, longitude,
                         total_area, number_of_floors, number_of_units, project_status, launch_date,
                         expected_completion_date, actual_completion_date, rera_extension_details,
                         land_ownership_title, land_owner_name, land_area, land_id, approval_authorities,
                         approved_building_plans, bank_name, loan_amount_sanctioned, total_amount_collected,
                         funding_sources, litigation_history, rera_complaints_count, rera_complaints_status,
                         trust_score, builder_score, project_score, completion, price_rise, location,
                         created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        project.id, project.name, project.reraNumber, project.builderName, project.builderId,
                        project.address, project.latitude, project.longitude, project.totalArea,
                        project.numberOfFloors, project.numberOfUnits, project.projectStatus,
                        project.launchDate, project.expectedCompletionDate, project.actualCompletionDate,
                        project.reraExtensionDetails, project.landOwnershipTitle, project.landOwnerName,
                        project.landArea, project.landId, project.approvalAuthorities,
                        project.approvedBuildingPlans, project.bankName, project.loanAmountSanctioned,
                        project.totalAmountCollected, project.fundingSources, project.litigationHistory,
                        project.reraComplaintsCount, project.reraComplaintsStatus, project.trustScore,
                        project.builderScore, project.projectScore, project.completion, project.priceRise,
                        project.location, project.createdAt, project.updatedAt
                    ]);
                    addedCount++;
                } catch (err) {
                    console.log(`   ⚠ Could not insert ${project.name} to MySQL: ${err.message}`);
                    // Fall through to in-memory
                }
            }
            
            // Always add to in-memory as fallback
            if (!db.trustScoreProjects.some(p => p.id === project.id)) {
                db.trustScoreProjects.push(project);
                if (!pool) addedCount++;
            }
        }
        
        console.log(`✓ Projects: ${addedCount} added, ${skippedCount} skipped (total: ${projects.length})`);

        // 4. Create Sample Builders
        console.log('\n4. Creating sample builders...');
        
        const builders = [
            {
                id: 'builder_lodha',
                name: 'Lodha Group',
                reraRegistration: 'RERA-MH-12345',
                address: 'Mumbai, Maharashtra',
                totalProjects: 45,
                deliveredProjects: 40,
                ongoingProjects: 5,
                delayedProjects: 3,
                deliveredOnTime: 88,
                reraComplaints: 2,
                cidcoComplaints: 1,
                landTitleDisputes: 0,
                averageUserRating: 4.5,
                totalReviews: 1250,
                yearsInBusiness: 35,
                trustScore: 90,
                createdAt: new Date()
            },
            {
                id: 'builder_godrej',
                name: 'Godrej Properties',
                reraRegistration: 'RERA-MH-12346',
                address: 'Mumbai, Maharashtra',
                totalProjects: 38,
                deliveredProjects: 36,
                ongoingProjects: 2,
                delayedProjects: 0,
                deliveredOnTime: 95,
                reraComplaints: 0,
                cidcoComplaints: 0,
                landTitleDisputes: 0,
                averageUserRating: 4.8,
                totalReviews: 980,
                yearsInBusiness: 40,
                trustScore: 95,
                createdAt: new Date()
            },
            {
                id: 'builder_dlf',
                name: 'DLF Limited',
                reraRegistration: 'RERA-UP-12347',
                address: 'Noida, Uttar Pradesh',
                totalProjects: 52,
                deliveredProjects: 45,
                ongoingProjects: 7,
                delayedProjects: 5,
                deliveredOnTime: 85,
                reraComplaints: 5,
                cidcoComplaints: 2,
                landTitleDisputes: 1,
                averageUserRating: 4.2,
                totalReviews: 2100,
                yearsInBusiness: 75,
                trustScore: 88,
                createdAt: new Date()
            }
        ];

        // Initialize in-memory arrays if they don't exist
        if (!db.trustScoreBuilders) {
            db.trustScoreBuilders = [];
        }

        let builderAddedCount = 0;
        let builderSkippedCount = 0;

        for (const builder of builders) {
            // Check if builder already exists
            let exists = false;
            
            if (pool) {
                try {
                    const [rows] = await pool.query('SELECT id FROM trust_score_builders WHERE id = ?', [builder.id]);
                    exists = rows && rows.length > 0;
                } catch (err) {
                    // Table might not exist yet
                }
            } else {
                exists = db.trustScoreBuilders.some(b => b.id === builder.id);
            }
            
            if (exists) {
                builderSkippedCount++;
                continue;
            }
            
            // Add builder
            if (pool) {
                try {
                    await pool.query(`
                        INSERT INTO trust_score_builders
                        (id, name, rera_registration, address, total_projects, delivered_projects,
                         ongoing_projects, delayed_projects, delivered_on_time, rera_complaints,
                         cidco_complaints, land_title_disputes, average_user_rating, total_reviews,
                         years_in_business, trust_score, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        builder.id, builder.name, builder.reraRegistration, builder.address,
                        builder.totalProjects, builder.deliveredProjects, builder.ongoingProjects,
                        builder.delayedProjects, builder.deliveredOnTime, builder.reraComplaints,
                        builder.cidcoComplaints, builder.landTitleDisputes, builder.averageUserRating,
                        builder.totalReviews, builder.yearsInBusiness, builder.trustScore, builder.createdAt
                    ]);
                    builderAddedCount++;
                } catch (err) {
                    console.log(`   ⚠ Could not insert ${builder.name} to MySQL: ${err.message}`);
                }
            }
            
            // Always add to in-memory as fallback
            if (!db.trustScoreBuilders.some(b => b.id === builder.id)) {
                db.trustScoreBuilders.push(builder);
                if (!pool) builderAddedCount++;
            }
        }
        console.log(`✓ Builders: ${builderAddedCount} added, ${builderSkippedCount} skipped (total: ${builders.length})`);

        // 5. Create Reviews
        console.log('\n5. Creating sample reviews...');
        
        const reviews = [
            {
                id: 'rev_1',
                userId: 'usr_trust1',
                entityType: 'project',
                entityId: 'proj_sunshine',
                entityName: 'Sunshine Towers',
                rating: 5,
                title: 'Excellent Project',
                review: 'Great location, good quality construction. Builder delivered on time.',
                tags: JSON.stringify(['On-Time Delivery', 'Quality', 'Location']),
                helpfulCount: 12,
                createdAt: new Date()
            },
            {
                id: 'rev_2',
                entityType: 'builder',
                entityId: 'builder_lodha',
                entityName: 'Lodha Group',
                rating: 4,
                title: 'Reliable Builder',
                review: 'Good track record, professional approach.',
                tags: JSON.stringify(['Transparency', 'Customer Service']),
                helpfulCount: 8,
                createdAt: new Date()
            },
            {
                id: 'rev_3',
                entityType: 'project',
                entityId: 'proj_greenfield',
                entityName: 'Greenfield Estate',
                rating: 5,
                title: 'Best Investment',
                review: 'Near completion, excellent amenities, great value.',
                tags: JSON.stringify(['Value for Money', 'Amenities']),
                helpfulCount: 15,
                createdAt: new Date()
            }
        ];

        // Initialize in-memory arrays if they don't exist
        if (!db.trustScoreReviews) {
            db.trustScoreReviews = [];
        }

        let reviewAddedCount = 0;
        let reviewSkippedCount = 0;

        for (const review of reviews) {
            // Check if review already exists
            let exists = false;
            
            if (pool) {
                try {
                    const [rows] = await pool.query('SELECT id FROM trust_score_reviews WHERE id = ?', [review.id]);
                    exists = rows && rows.length > 0;
                } catch (err) {
                    // Table might not exist yet
                }
            } else {
                exists = db.trustScoreReviews.some(r => r.id === review.id);
            }
            
            if (exists) {
                reviewSkippedCount++;
                continue;
            }
            
            // Add review
            if (pool) {
                try {
                    await pool.query(`
                        INSERT INTO trust_score_reviews
                        (id, user_id, entity_type, entity_id, entity_name, rating, title, review, tags, helpful_count, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        review.id, review.userId, review.entityType, review.entityId, review.entityName,
                        review.rating, review.title, review.review, review.tags, review.helpfulCount, review.createdAt
                    ]);
                    reviewAddedCount++;
                } catch (err) {
                    console.log(`   ⚠ Could not insert review ${review.id} to MySQL: ${err.message}`);
                }
            }
            
            // Always add to in-memory as fallback
            if (!db.trustScoreReviews.some(r => r.id === review.id)) {
                db.trustScoreReviews.push(review);
                if (!pool) reviewAddedCount++;
            }
        }
        console.log(`✓ Reviews: ${reviewAddedCount} added, ${reviewSkippedCount} skipped (total: ${reviews.length})`);

        // 6. Create Complaints
        console.log('\n6. Creating sample complaints...');
        
        const complaints = [
            {
                id: 'comp_1',
                userId: 'usr_trust1',
                projectId: 'proj_bluesapphire',
                projectName: 'Blue Sapphire',
                issueType: 'Land Dispute',
                description: 'Land has been sold to multiple parties. This is a fraud case.',
                status: 'Pending',
                documents: JSON.stringify(['fraud_report.pdf']),
                createdAt: new Date()
            },
            {
                id: 'comp_2',
                projectId: 'proj_lakeview',
                projectName: 'Lakeview Homes',
                issueType: 'Construction Delay',
                description: 'Project is delayed by 6 months. Builder not responding.',
                status: 'Pending',
                documents: JSON.stringify([]),
                createdAt: new Date()
            },
            {
                id: 'comp_sunshine_1',
                userId: 'usr_trust1',
                projectId: 'proj_sunshine',
                projectName: 'Sunshine Towers',
                issueType: 'Possession Delay',
                description: 'Possession promised for Q2 2024 but still not handed over. No clear timeline from builder.',
                status: 'Pending',
                documents: JSON.stringify([]),
                createdAt: new Date('2024-03-10')
            }
        ];

        // Initialize in-memory arrays if they don't exist
        if (!db.trustScoreComplaints) {
            db.trustScoreComplaints = [];
        }

        let complaintAddedCount = 0;
        let complaintSkippedCount = 0;

        for (const complaint of complaints) {
            // Check if complaint already exists
            let exists = false;
            
            if (pool) {
                try {
                    const [rows] = await pool.query('SELECT id FROM trust_score_complaints WHERE id = ?', [complaint.id]);
                    exists = rows && rows.length > 0;
                } catch (err) {
                    // Table might not exist yet
                }
            } else {
                exists = db.trustScoreComplaints.some(c => c.id === complaint.id);
            }
            
            if (exists) {
                complaintSkippedCount++;
                continue;
            }
            
            // Add complaint
            if (pool) {
                try {
                    await pool.query(`
                        INSERT INTO trust_score_complaints
                        (id, user_id, project_id, project_name, issue_type, description, status, documents, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        complaint.id, complaint.userId || null, complaint.projectId, complaint.projectName,
                        complaint.issueType, complaint.description, complaint.status, complaint.documents, complaint.createdAt
                    ]);
                    complaintAddedCount++;
                } catch (err) {
                    console.log(`   ⚠ Could not insert complaint ${complaint.id} to MySQL: ${err.message}`);
                }
            }
            
            // Always add to in-memory as fallback
            if (!db.trustScoreComplaints.some(c => c.id === complaint.id)) {
                db.trustScoreComplaints.push(complaint);
                if (!pool) complaintAddedCount++;
            }
        }
        console.log(`✓ Complaints: ${complaintAddedCount} added, ${complaintSkippedCount} skipped (total: ${complaints.length})`);

        // 7. Create Fraud Alerts
        console.log('\n7. Creating fraud alerts...');
        
        const fraudAlerts = [
            {
                id: 'fraud_1',
                landId: 'LAND-MUM-003',
                latitude: 19.0596,
                longitude: 72.8295,
                projectId: 'proj_bluesapphire',
                projectName: 'Blue Sapphire',
                fraudType: 'multiple_sales',
                severity: 'high',
                status: 'active',
                details: JSON.stringify({
                    issue: 'Land sold twice',
                    sales: [
                        { buyer: 'Buyer 1', date: '2018-01-15' },
                        { buyer: 'Buyer 2', date: '2020-03-20' }
                    ]
                }),
                createdAt: new Date()
            },
            {
                id: 'fraud_2',
                landId: 'LAND-MUM-004',
                latitude: 19.1176,
                longitude: 72.9067,
                projectId: null,
                projectName: 'Riverdale Phase 3',
                fraudType: 'rera_complaints',
                severity: 'medium',
                status: 'active',
                details: JSON.stringify({
                    issue: '12 RERA complaints unresolved',
                    complaintCount: 12
                }),
                createdAt: new Date()
            }
        ];

        // Initialize in-memory arrays if they don't exist
        if (!db.trustScoreFraudAlerts) {
            db.trustScoreFraudAlerts = [];
        }

        let alertAddedCount = 0;
        let alertSkippedCount = 0;

        for (const alert of fraudAlerts) {
            // Check if alert already exists
            let exists = false;
            
            if (pool) {
                try {
                    const [rows] = await pool.query('SELECT id FROM trust_score_fraud_alerts WHERE id = ?', [alert.id]);
                    exists = rows && rows.length > 0;
                } catch (err) {
                    // Table might not exist yet
                }
            } else {
                exists = db.trustScoreFraudAlerts.some(a => a.id === alert.id);
            }
            
            if (exists) {
                alertSkippedCount++;
                continue;
            }
            
            // Add alert
            if (pool) {
                try {
                    await pool.query(`
                        INSERT INTO trust_score_fraud_alerts
                        (id, land_id, latitude, longitude, project_id, project_name, fraud_type, severity, status, details, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        alert.id, alert.landId, alert.latitude, alert.longitude, alert.projectId,
                        alert.projectName, alert.fraudType, alert.severity, alert.status,
                        alert.details, alert.createdAt
                    ]);
                    alertAddedCount++;
                } catch (err) {
                    console.log(`   ⚠ Could not insert fraud alert ${alert.id} to MySQL: ${err.message}`);
                }
            }
            
            // Always add to in-memory as fallback
            if (!db.trustScoreFraudAlerts.some(a => a.id === alert.id)) {
                db.trustScoreFraudAlerts.push(alert);
                if (!pool) alertAddedCount++;
            }
        }
        console.log(`✓ Fraud Alerts: ${alertAddedCount} added, ${alertSkippedCount} skipped (total: ${fraudAlerts.length})`);

        // 8. Create Watchlist
        console.log('\n8. Creating watchlist...');
        
        const watchlist = [
            {
                id: 'watch_1',
                userId: 'usr_trust1',
                projectId: 'proj_sunshine',
                projectName: 'Sunshine Towers',
                createdAt: new Date()
            },
            {
                id: 'watch_2',
                userId: 'usr_trust1',
                projectId: 'proj_greenfield',
                projectName: 'Greenfield Estate',
                createdAt: new Date()
            }
        ];

        // Initialize in-memory arrays if they don't exist
        if (!db.trustScoreWatchlist) {
            db.trustScoreWatchlist = [];
        }

        let watchlistAddedCount = 0;
        let watchlistSkippedCount = 0;

        for (const item of watchlist) {
            // Check if watchlist item already exists
            let exists = false;
            
            if (pool) {
                try {
                    const [rows] = await pool.query('SELECT id FROM trust_score_watchlist WHERE id = ?', [item.id]);
                    exists = rows && rows.length > 0;
                } catch (err) {
                    // Table might not exist yet
                }
            } else {
                exists = db.trustScoreWatchlist.some(w => w.id === item.id);
            }
            
            if (exists) {
                watchlistSkippedCount++;
                continue;
            }
            
            // Add watchlist item
            if (pool) {
                try {
                    await pool.query(`
                        INSERT INTO trust_score_watchlist
                        (id, user_id, project_id, project_name, created_at)
                        VALUES (?, ?, ?, ?, ?)
                    `, [item.id, item.userId, item.projectId, item.projectName, item.createdAt]);
                    watchlistAddedCount++;
                } catch (err) {
                    console.log(`   ⚠ Could not insert watchlist item ${item.id} to MySQL: ${err.message}`);
                }
            }
            
            // Always add to in-memory as fallback
            if (!db.trustScoreWatchlist.some(w => w.id === item.id)) {
                db.trustScoreWatchlist.push(item);
                if (!pool) watchlistAddedCount++;
            }
        }
        console.log(`✓ Watchlist: ${watchlistAddedCount} added, ${watchlistSkippedCount} skipped (total: ${watchlist.length})`);

        // 9. Create Land Ledger (for fraud detection)
        console.log('\n9. Creating land ledger...');
        
        const ledgerEntries = [
            {
                id: 'ledger_1',
                landId: 'LAND-MUM-003',
                latitude: 19.0596,
                longitude: 72.8295,
                buyerId: 'buyer_1',
                buyerName: 'First Buyer',
                saleDate: '2018-01-15',
                amount: '₹50 Crores',
                status: 'verified',
                createdAt: new Date()
            },
            {
                id: 'ledger_2',
                landId: 'LAND-MUM-003',
                latitude: 19.0596,
                longitude: 72.8295,
                buyerId: 'buyer_2',
                buyerName: 'Second Buyer',
                saleDate: '2020-03-20',
                amount: '₹60 Crores',
                status: 'disputed',
                createdAt: new Date()
            }
        ];

        // Initialize in-memory arrays if they don't exist
        if (!db.trustScoreLandLedger) {
            db.trustScoreLandLedger = [];
        }

        let ledgerAddedCount = 0;
        let ledgerSkippedCount = 0;

        for (const entry of ledgerEntries) {
            // Check if ledger entry already exists
            let exists = false;
            
            if (pool) {
                try {
                    const [rows] = await pool.query('SELECT id FROM trust_score_land_ledger WHERE id = ?', [entry.id]);
                    exists = rows && rows.length > 0;
                } catch (err) {
                    // Table might not exist yet
                }
            } else {
                exists = db.trustScoreLandLedger.some(l => l.id === entry.id);
            }
            
            if (exists) {
                ledgerSkippedCount++;
                continue;
            }
            
            // Add ledger entry
            if (pool) {
                try {
                    await pool.query(`
                        INSERT INTO trust_score_land_ledger
                        (id, land_id, latitude, longitude, buyer_id, buyer_name, sale_date, amount, status, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        entry.id, entry.landId, entry.latitude, entry.longitude,
                        entry.buyerId, entry.buyerName, entry.saleDate, entry.amount,
                        entry.status, entry.createdAt
                    ]);
                    ledgerAddedCount++;
                } catch (err) {
                    console.log(`   ⚠ Could not insert ledger entry ${entry.id} to MySQL: ${err.message}`);
                }
            }
            
            // Always add to in-memory as fallback
            if (!db.trustScoreLandLedger.some(l => l.id === entry.id)) {
                db.trustScoreLandLedger.push(entry);
                if (!pool) ledgerAddedCount++;
            }
        }
        console.log(`✓ Land Ledger: ${ledgerAddedCount} added, ${ledgerSkippedCount} skipped (total: ${ledgerEntries.length})`);

        // 10. Create Contributor Scores
        console.log('\n10. Creating contributor scores...');
        
        const contributorScores = [
            {
                userId: 'usr_trust1',
                score: 850,
                rating: 'Excellent',
                pointsThisMonth: 12,
                totalPoints: 850,
                activities: JSON.stringify([
                    { type: 'review', points: 5, date: '2024-01-10' },
                    { type: 'complaint', points: 15, date: '2024-01-12' },
                    { type: 'project_added', points: 10, date: '2024-01-08' }
                ]),
                updatedAt: new Date()
            }
        ];

        // Initialize in-memory arrays if they don't exist
        if (!db.trustScoreContributorScores) {
            db.trustScoreContributorScores = [];
        }

        let scoreAddedCount = 0;
        let scoreSkippedCount = 0;

        for (const score of contributorScores) {
            // Check if contributor score already exists
            let exists = false;
            
            if (pool) {
                try {
                    const [rows] = await pool.query('SELECT user_id FROM trust_score_contributor_scores WHERE user_id = ?', [score.userId]);
                    exists = rows && rows.length > 0;
                } catch (err) {
                    // Table might not exist yet
                }
            } else {
                exists = db.trustScoreContributorScores.some(s => s.userId === score.userId);
            }
            
            if (exists) {
                scoreSkippedCount++;
                continue;
            }
            
            // Add contributor score
            if (pool) {
                try {
                    await pool.query(`
                        INSERT INTO trust_score_contributor_scores
                        (user_id, score, rating, points_this_month, total_points, activities, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [
                        score.userId, score.score, score.rating, score.pointsThisMonth,
                        score.totalPoints, score.activities, score.updatedAt
                    ]);
                    scoreAddedCount++;
                } catch (err) {
                    console.log(`   ⚠ Could not insert contributor score for ${score.userId} to MySQL: ${err.message}`);
                }
            }
            
            // Always add to in-memory as fallback
            if (!db.trustScoreContributorScores.some(s => s.userId === score.userId)) {
                db.trustScoreContributorScores.push(score);
                if (!pool) scoreAddedCount++;
            }
        }
        console.log(`✓ Contributor Scores: ${scoreAddedCount} added, ${scoreSkippedCount} skipped (total: ${contributorScores.length})`);

        console.log('\n✅ Trust Score data seeding completed successfully!\n');
        
        // Summary
        console.log('Summary:');
        console.log(`- Users: 2 (trust1, trustvendor1)`);
        console.log(`- Vendor: 1 (v_trust1)`);
        console.log(`- Projects: ${projects.length} (max 10 as requested)`);
        console.log(`- Builders: ${builders.length}`);
        console.log(`- Reviews: ${reviews.length}`);
        console.log(`- Complaints: ${complaints.length}`);
        console.log(`- Fraud Alerts: ${fraudAlerts.length}`);
        console.log(`- Watchlist Items: ${watchlist.length}`);
        console.log(`- Land Ledger Entries: ${ledgerEntries.length}`);

    } catch (error) {
        console.error('\n❌ Error seeding Trust Score data:', error);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    seedTrustScoreData()
        .then(() => {
            console.log('\n✅ Seeding completed. Now syncing to MySQL...\n');
            // Sync to MySQL will be handled separately
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Seeding failed:', error);
            process.exit(1);
        });
}

module.exports = { seedTrustScoreData };

