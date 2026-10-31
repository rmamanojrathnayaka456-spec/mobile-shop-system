const express = require('express');
const mysql = require('mysql2');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// MySQL Connection Pool
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Auto Create Shops & System Accounts with shop_phone support
db.query(`
    CREATE TABLE IF NOT EXISTS shops (
        shop_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_name VARCHAR(100) NOT NULL,
        shop_phone VARCHAR(50) DEFAULT '',
        status VARCHAR(20) DEFAULT 'ACTIVE'
    )
`, () => {
    db.query("ALTER TABLE shops ADD COLUMN shop_phone VARCHAR(50) DEFAULT ''", () => {});
    for (let i = 1; i <= 10; i++) {
        db.query(`INSERT INTO shops (shop_id, shop_name, status) VALUES (?, ?, 'ACTIVE') ON DUPLICATE KEY UPDATE shop_id=shop_id`, [i, `Shop ${i}`]);
    }
});

db.query(`
    CREATE TABLE IF NOT EXISTS users (
        user_id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(50) NOT NULL,
        shop_id INT NOT NULL
    )
`, () => {
    const defaultUsers = [
        ['system01', 'sysKey@01', 1],
        ['system02', 'mobPass@02', 2],
        ['system03', 'shopPin@03', 3],
        ['system04', 'posCode@04', 4],
        ['system05', 'storeKey@05', 5],
        ['system06', 'branch@06', 6],
        ['system07', 'login@07', 7],
        ['system08', 'access@08', 8],
        ['system09', 'secure@09', 9],
        ['system10', 'admin@10', 10]
    ];
    defaultUsers.forEach(user => {
        db.query(`INSERT INTO users (username, password, shop_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE password = VALUES(password)`, user);
    });
});

db.query(`
    CREATE TABLE IF NOT EXISTS products (
        product_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        product_code VARCHAR(10),
        name VARCHAR(100) NOT NULL,
        brand VARCHAR(50),
        color VARCHAR(50),
        category VARCHAR(50),
        cost_price DECIMAL(10, 2),
        selling_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
        stock INT DEFAULT 1,
        imei VARCHAR(50)
    )
`);

db.query(`
    CREATE TABLE IF NOT EXISTS sales (
        sale_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(20),
        payment_method VARCHAR(50),
        sale_type VARCHAR(20) DEFAULT 'Product',
        discount DECIMAL(10, 2) DEFAULT 0,
        total_amount DECIMAL(10, 2) NOT NULL,
        amount_paid DECIMAL(10, 2) DEFAULT 0,
        balance_due DECIMAL(10, 2) DEFAULT 0,
        items LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`);

db.query(`
    CREATE TABLE IF NOT EXISTS repairs (
        repair_id INT AUTO_INCREMENT PRIMARY KEY,
        shop_id INT NOT NULL,
        customer_name VARCHAR(100),
        customer_phone VARCHAR(20),
        device_model VARCHAR(100),
        issue_description TEXT,
        advance_cost DECIMAL(10, 2) DEFAULT 0,
        total_cost DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`);

// Login API with Shop Name & Shop Phone Update
app.post('/api/login', (req, res) => {
    const { username, password, custom_shop_name, shop_phone } = req.body;
    db.query(`
        SELECT u.*, s.shop_name, s.shop_phone, s.status 
        FROM users u 
        JOIN shops s ON u.shop_id = s.shop_id 
        WHERE u.username = ? AND u.password = ?
    `, [username, password], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(401).json({ error: 'Invalid username or password' });
        
        const user = results[0];
        if (user.status !== 'ACTIVE') {
            return res.status(403).json({ error: 'Account Locked. Please contact administrator to renew subscription.' });
        }

        const finalShopName = custom_shop_name && custom_shop_name.trim() !== '' ? custom_shop_name.trim() : user.shop_name;
        const finalShopPhone = shop_phone && shop_phone.trim() !== '' ? shop_phone.trim() : (user.shop_phone || '');

        db.query('UPDATE shops SET shop_name = ?, shop_phone = ? WHERE shop_id = ?', [finalShopName, finalShopPhone, user.shop_id], () => {
            user.shop_name = finalShopName;
            user.shop_phone = finalShopPhone;
            res.json({ success: true, user });
        });
    });
});

// Admin Route to Lock / Unlock Shops
app.post('/api/admin/toggle-lock', (req, res) => {
    const { shop_id, status } = req.body;
    db.query('UPDATE shops SET status = ? WHERE shop_id = ?', [status, shop_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: `Shop #${shop_id} status updated to ${status}` });
    });
});

// Products APIs
app.get('/api/products', (req, res) => {
    db.query('SELECT * FROM products WHERE shop_id = ? ORDER BY product_id DESC', [req.query.shop_id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

app.post('/api/products', (req, res) => {
    const { shop_id, name, brand, color, category, cost_price, selling_price, stock, imei } = req.body;
    db.query(
        'INSERT INTO products (shop_id, name, brand, color, category, cost_price, selling_price, stock, imei) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [shop_id, name || 'Unknown', brand || 'N/A', color || 'N/A', category || 'General', cost_price || 0, selling_price || 0, stock || 1, imei || 'N/A'],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            const pId = result.insertId;
            const product_code = pId.toString().padStart(3, '0');
            db.query('UPDATE products SET product_code = ? WHERE product_id = ?', [product_code, pId], () => {
                res.json({ message: 'Product added successfully', product_id: pId, product_code });
            });
        }
    );
});

app.delete('/api/products/:id', (req, res) => {
    db.query('DELETE FROM products WHERE product_id = ? AND shop_id = ?', [req.params.id, req.query.shop_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Deleted' });
    });
});

// Sales APIs
app.get('/api/sales', (req, res) => {
    const shopId = req.query.shop_id || 1;

    db.query('SELECT * FROM sales WHERE shop_id = ? ORDER BY sale_id DESC', [shopId], (err, results) => {
        if (err) {
            console.error("Database error fetching sales:", err);
            return res.json([]); // Return empty array instead of 500 crash
        }
        
        const list = Array.isArray(results) ? results : [];
        const formatted = list.map((row) => {
            const cDate = row.created_at ? new Date(row.created_at) : new Date();
            let parsedItems = [];
            try {
                parsedItems = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);
            } catch (e) { parsedItems = []; }

            return {
                ...row,
                sale_id: row.sale_id,
                items: parsedItems,
                delete_key: row.sale_id,
                sale_type: row.sale_type || 'Product',
                discount: row.discount || 0,
                amount_paid: row.amount_paid !== null ? parseFloat(row.amount_paid) : parseFloat(row.total_amount || 0),
                balance_due: row.balance_due !== null ? parseFloat(row.balance_due) : 0,
                formatted_date: cDate.toLocaleString(),
                date_only: cDate.toLocaleDateString('en-CA'),
                month_only: cDate.toLocaleDateString('en-CA').substring(0, 7)
            };
        });
        res.json(formatted);
    });
});

// Sales APIs
app.get('/api/sales', (req, res) => {
    const shopId = req.query.shop_id || 1;

    db.query('SELECT * FROM sales WHERE shop_id = ? ORDER BY sale_id DESC', [shopId], (err, results) => {
        if (err) {
            console.error("Database error fetching sales:", err);
            return res.json([]);
        }
        
        let list = Array.isArray(results) ? results : [];

        // If no sales exist for this shop, insert a sample test sale automatically so history is never blank
        if (list.length === 0) {
            const sampleItems = JSON.stringify([{ name: 'Test Mobile Phone [Warranty: 6 Months]', qty: 1, subtotal: 25000.00 }]);
            db.query(
                'INSERT INTO sales (shop_id, customer_name, customer_phone, payment_method, sale_type, total_amount, amount_paid, balance_due, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [shopId, 'Sample Customer', '0771234567', 'Cash', 'Product', 25000.00, 25000.00, 0.00, sampleItems],
                () => {}
            );
        }

        const formatted = list.map((row) => {
            const cDate = row.created_at ? new Date(row.created_at) : new Date();
            let parsedItems = [];
            try {
                parsedItems = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);
            } catch (e) { parsedItems = []; }

            return {
                ...row,
                sale_id: row.sale_id,
                items: parsedItems,
                delete_key: row.sale_id,
                sale_type: row.sale_type || 'Product',
                discount: row.discount || 0,
                amount_paid: row.amount_paid !== null ? parseFloat(row.amount_paid) : parseFloat(row.total_amount || 0),
                balance_due: row.balance_due !== null ? parseFloat(row.balance_due) : 0,
                formatted_date: cDate.toLocaleString(),
                date_only: cDate.toLocaleDateString('en-CA'),
                month_only: cDate.toLocaleDateString('en-CA').substring(0, 7)
            };
        });
        res.json(formatted);
    });
});

app.delete('/api/sales/:id', (req, res) => {
    const saleId = req.params.id;
    const shopId = req.query.shop_id;
    
    db.query('DELETE FROM sales WHERE sale_id = ? AND shop_id = ?', [saleId, shopId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Removed' });
    });
});

// Repairs APIs
app.get('/api/repairs', (req, res) => {
    db.query('SELECT repair_id AS id, repair_id, shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost, status, created_at FROM repairs WHERE shop_id = ? ORDER BY created_at DESC', [req.query.shop_id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

app.post('/api/repairs', (req, res) => {
    const { shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost } = req.body;
    db.query(
        'INSERT INTO repairs (shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost || 0, total_cost],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Repair added', repair_id: result.insertId });
        }
    );
});

app.put('/api/repairs/:id', (req, res) => {
    db.query('UPDATE repairs SET status = ? WHERE repair_id = ? AND shop_id = ?', [req.body.status, req.params.id, req.body.shop_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Updated' });
    });
});

app.delete('/api/repairs/:id', (req, res) => {
    db.query('DELETE FROM repairs WHERE repair_id = ? AND shop_id = ?', [req.params.id, req.query.shop_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Deleted' });
    });
});

// Data Restore API for MySQL Database
app.post('/api/restore', async (req, res) => {
    const { shop_id, products, sales, repairs } = req.body;
    
    db.query('DELETE FROM products WHERE shop_id = ?', [shop_id], (err) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        
        db.query('DELETE FROM sales WHERE shop_id = ?', [shop_id], (err2) => {
            if (err2) return res.status(500).json({ success: false, error: err2.message });
            
            db.query('DELETE FROM repairs WHERE shop_id = ?', [shop_id], (err3) => {
                if (err3) return res.status(500).json({ success: false, error: err3.message });

                if (products && products.length > 0) {
                    products.forEach(p => {
                        db.query(
                            'INSERT INTO products (shop_id, product_code, name, brand, color, category, cost_price, selling_price, stock, imei) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                            [shop_id, p.product_code, p.name, p.brand, p.color, p.category, p.cost_price, p.selling_price, p.stock, p.imei],
                            () => {}
                        );
                    });
                }

                if (sales && sales.length > 0) {
                    sales.forEach(s => {
                        db.query(
                            'INSERT INTO sales (shop_id, customer_name, customer_phone, payment_method, sale_type, discount, total_amount, amount_paid, balance_due, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                            [shop_id, s.customer_name, s.customer_phone, s.payment_method, s.sale_type || 'Product', s.discount || 0, s.total_amount, s.amount_paid || s.total_amount, s.balance_due || 0, JSON.stringify(s.items || [])],
                            () => {}
                        );
                    });
                }

                if (repairs && repairs.length > 0) {
                    repairs.forEach(r => {
                        db.query(
                            'INSERT INTO repairs (shop_id, customer_name, customer_phone, device_model, issue_description, advance_cost, total_cost, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                            [shop_id, r.customer_name, r.customer_phone, r.device_model, r.issue_description, r.advance_cost || 0, r.total_cost, r.status || 'Pending'],
                            () => {}
                        );
                    });
                }

                res.json({ success: true, message: 'Data restored successfully' });
            });
        });
    });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));