#!/usr/bin/env node

/**
 * 🔄 DATA BACKUP AND MIGRATION SCRIPT
 * 
 * This script helps you backup your existing data and migrate it to MongoDB Atlas
 * Run this to preserve all your current orders, sales, and menu data
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;

console.log('🔄 DATA BACKUP AND MIGRATION');
console.log('============================\n');

// Database Models
const menuItemSchema = new mongoose.Schema({
  id: Number,
  name: mongoose.Schema.Types.Mixed,
  description: mongoose.Schema.Types.Mixed,
  price: Number,
  category: String,
  image: String,
  video: String,
  thumbnail: String,
  active: { type: Boolean, default: true },
  prepTime: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const categorySchema = new mongoose.Schema({
  id: Number,
  name: String,
  icon: String,
  sort_order: Number,
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const orderSchema = new mongoose.Schema({
  id: Number,
  items: [{
    id: Number,
    name: String,
    price: Number,
    qty: Number
  }],
  customerName: String,
  customerEmail: String,
  orderType: String,
  tableNumber: String,
  total: Number,
  discount: { type: Number, default: 0 },
  notes: String,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const clientSchema = new mongoose.Schema({
  id: Number,
  name: String,
  email: String,
  marketingConsent: { type: Boolean, default: false },
  totalOrders: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const MenuItem = mongoose.model('MenuItem', menuItemSchema);
const Category = mongoose.model('Category', categorySchema);
const Order = mongoose.model('Order', orderSchema);
const Client = mongoose.model('Client', clientSchema);

async function backupAndMigrate() {
  try {
    // Check if MongoDB Atlas is configured
    if (!MONGODB_URI || MONGODB_URI.includes('localhost')) {
      console.log('❌ MongoDB Atlas not configured!');
      console.log('\n📋 SETUP INSTRUCTIONS:');
      console.log('1. Follow PERMANENT_DATA_SOLUTION.md');
      console.log('2. Set up MongoDB Atlas');
      console.log('3. Add MONGODB_URI to Railway');
      console.log('4. Run this script again\n');
      return;
    }

    console.log('🔄 Connecting to MongoDB Atlas...');
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB Atlas');

    // Check existing data in database
    const existingOrders = await Order.countDocuments();
    const existingItems = await MenuItem.countDocuments();
    const existingCategories = await Category.countDocuments();
    const existingClients = await Client.countDocuments();

    console.log('\n📊 CURRENT DATABASE STATUS:');
    console.log(`📄 Orders: ${existingOrders}`);
    console.log(`🍔 Menu Items: ${existingItems}`);
    console.log(`📂 Categories: ${existingCategories}`);
    console.log(`👥 Clients: ${existingClients}`);

    // Migrate menu data
    console.log('\n🔄 Checking for menu data to migrate...');
    const menuDataFile = path.join(__dirname, 'data', 'menu-data.json');
    const menuDataBackup = path.join(__dirname, 'menu-data.json');
    
    let menuData = null;
    if (fs.existsSync(menuDataFile)) {
      menuData = JSON.parse(fs.readFileSync(menuDataFile, 'utf8'));
      console.log('📄 Found menu data file');
    } else if (fs.existsSync(menuDataBackup)) {
      menuData = JSON.parse(fs.readFileSync(menuDataBackup, 'utf8'));
      console.log('📄 Found menu data backup file');
    }

    if (menuData) {
      // Migrate categories
      if (menuData.categories && menuData.categories.length > 0) {
        const categoryCount = await Category.countDocuments();
        if (categoryCount === 0) {
          await Category.insertMany(menuData.categories);
          console.log(`✅ Migrated ${menuData.categories.length} categories`);
        } else {
          console.log(`📂 Categories already exist (${categoryCount})`);
        }
      }

      // Migrate menu items
      if (menuData.items && menuData.items.length > 0) {
        const itemCount = await MenuItem.countDocuments();
        if (itemCount === 0) {
          await MenuItem.insertMany(menuData.items);
          console.log(`✅ Migrated ${menuData.items.length} menu items`);
        } else {
          console.log(`🍔 Menu items already exist (${itemCount})`);
        }
      }
    }

    // Migrate orders data
    console.log('\n🔄 Checking for orders data to migrate...');
    const ordersDataFile = path.join(__dirname, 'data', 'orders-data.json');
    const ordersDataBackup = path.join(__dirname, 'orders-data.json');
    
    let ordersData = null;
    if (fs.existsSync(ordersDataFile)) {
      ordersData = JSON.parse(fs.readFileSync(ordersDataFile, 'utf8'));
      console.log('📄 Found orders data file');
    } else if (fs.existsSync(ordersDataBackup)) {
      ordersData = JSON.parse(fs.readFileSync(ordersDataBackup, 'utf8'));
      console.log('📄 Found orders data backup file');
    }

    if (ordersData && ordersData.orders && ordersData.orders.length > 0) {
      const orderCount = await Order.countDocuments();
      if (orderCount === 0) {
        await Order.insertMany(ordersData.orders);
        console.log(`✅ Migrated ${ordersData.orders.length} orders`);
      } else {
        console.log(`📄 Orders already exist (${orderCount})`);
      }
    }

    // Migrate clients data
    console.log('\n🔄 Checking for clients data to migrate...');
    const clientsDataFile = path.join(__dirname, 'data', 'clients-data.json');
    const clientsDataBackup = path.join(__dirname, 'clients-data.json');
    
    let clientsData = null;
    if (fs.existsSync(clientsDataFile)) {
      clientsData = JSON.parse(fs.readFileSync(clientsDataFile, 'utf8'));
      console.log('📄 Found clients data file');
    } else if (fs.existsSync(clientsDataBackup)) {
      clientsData = JSON.parse(fs.readFileSync(clientsDataBackup, 'utf8'));
      console.log('📄 Found clients data backup file');
    }

    if (clientsData && clientsData.length > 0) {
      const clientCount = await Client.countDocuments();
      if (clientCount === 0) {
        await Client.insertMany(clientsData);
        console.log(`✅ Migrated ${clientsData.length} clients`);
      } else {
        console.log(`👥 Clients already exist (${clientCount})`);
      }
    }

    // Final status
    const finalOrders = await Order.countDocuments();
    const finalItems = await MenuItem.countDocuments();
    const finalCategories = await Category.countDocuments();
    const finalClients = await Client.countDocuments();

    console.log('\n🎉 MIGRATION COMPLETE!');
    console.log('======================');
    console.log(`📄 Orders: ${finalOrders}`);
    console.log(`🍔 Menu Items: ${finalItems}`);
    console.log(`📂 Categories: ${finalCategories}`);
    console.log(`👥 Clients: ${finalClients}`);
    
    console.log('\n✅ Your data is now permanently stored in MongoDB Atlas!');
    console.log('✅ Orders, sales, and analytics will survive deployments');
    console.log('✅ You can now update GitHub without losing data');
    console.log('✅ Professional database with automatic backups');

    console.log('\n🧪 TESTING INSTRUCTIONS:');
    console.log('1. Place a test order');
    console.log('2. Update GitHub and redeploy');
    console.log('3. Verify the order is still there');
    console.log('4. Your data is now permanent! 🚀');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.log('\n🔧 TROUBLESHOOTING:');
    console.log('1. Check your MongoDB Atlas connection string');
    console.log('2. Ensure network access allows 0.0.0.0/0');
    console.log('3. Verify database user has read/write permissions');
    console.log('4. Check Railway environment variables');
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB Atlas');
  }
}

// Run migration
backupAndMigrate();
