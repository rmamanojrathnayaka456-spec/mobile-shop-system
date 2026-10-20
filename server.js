// 3. Complete Sale / Checkout (Matching updated MySQL Workbench Schema)
app.post('/api/sales', (req, res) => {
    const { customer_name, customer_phone, items } = req.body;

    if (!items || items.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
    }

    const grandTotal = items.reduce((sum, item) => sum + item.subtotal, 0);

    db.getConnection((err, connection) => {
        if (err) return res.status(500).json({ error: "Database connection failed" });

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return res.status(500).json({ error: "Transaction initiation failed" });
            }

            // Step A: Insert Header into 'sales'
            const insertSalesHeader = `
                INSERT INTO sales (customer_name, customer_phone, total_amount)
                VALUES (?, ?, ?)
            `;

            connection.query(insertSalesHeader, [customer_name || 'Cash Customer', customer_phone || 'N/A', grandTotal], (err, result) => {
                if (err) {
                    return connection.rollback(() => {
                        connection.release();
                        res.status(500).json({ error: "Sales header creation failed: " + err.message });
                    });
                }

                const invoiceId = result.insertId;
                let completedItems = 0;

                // Step B: Insert Items into 'sale_items'
                items.forEach(item => {
                    const insertSaleItem = `
                        INSERT INTO sale_items (invoice_id, product_id, imei_number, quantity, selling_price, discount_amount, total_price, warranty_months)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `;

                    const itemDiscount = item.discount || 0;
                    const warranty = item.warranty_months || 0;

                    connection.query(insertSaleItem, [
                        invoiceId, 
                        item.product_id, 
                        item.imei_number || 'N/A', 
                        item.quantity, 
                        item.price, 
                        itemDiscount, 
                        item.subtotal, 
                        warranty
                    ], (err) => {
                        if (err) {
                            return connection.rollback(() => {
                                connection.release();
                                res.status(500).json({ error: "Sale item insertion failed: " + err.message });
                            });
                        }

                        // Deduct Stock Quantity
                        const updateStock = `UPDATE products SET stock_quantity = stock_quantity - ? WHERE product_id = ?`;
                        connection.query(updateStock, [item.quantity, item.product_id], (err) => {
                            if (err) {
                                return connection.rollback(() => {
                                    connection.release();
                                    res.status(500).json({ error: "Stock update failed" });
                                });
                            }

                            // Update Phone Stock Status if IMEI sold
                            if (item.imei_number) {
                                connection.query(`UPDATE phone_stock SET status = 'Sold' WHERE imei_number = ?`, [item.imei_number], () => {});
                            }

                            completedItems++;
                            if (completedItems === items.length) {
                                connection.commit((err) => {
                                    connection.release();
                                    if (err) return res.status(500).json({ error: "Commit failed" });
                                    res.json({ message: "Sale completed successfully!", invoice_id: invoiceId });
                                });
                            }
                        });
                    });
                });
            });
        });
    });
});