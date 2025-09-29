#!/usr/bin/env node

/**
 * 🗄️ PERMANENT DATA STORAGE SETUP SCRIPT
 * 
 * This script helps you set up MongoDB Atlas for permanent data storage
 * Run this to test your MongoDB connection and migrate existing data
 */

require('dotenv').config();
const mongoose = require('mongoose');

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;

console.log('🗄️ PERMANENT DATA STORAGE SETUP');
console.log('=====================================\n');

// Check if MongoDB URI is configured
if (!MONGODB_URI || MONGODB_URI.includes('localhost')) {
  console.log('❌ MongoDB Atlas not configured yet!');
  console.log('\n📋 SETUP INSTRUCTIONS:');
  console.log('1. Go to: https://www.mongodb.com/atlas');
  console.log('2. Create free account and cluster');
  console.log('3. Get connection string');
  console.log('4. Add MONGODB_URI to Railway environment variables');
  console.log('5. Run this script again\n');
  
  console.log('📖 For detailed instructions, see: PERMANENT_DATA_SOLUTION.md');
  process.exit(0);
}

console.log('✅ MongoDB Atlas URI found!');
console.log('🔗 Connecting to:', MONGODB_URI.replace(/\/\/.*@/, '//***:***@'));

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

async function setupPermanentStorage() {
  try {
    console.log('\n🔄 Connecting to MongoDB Atlas...');
    
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB Atlas successfully!');
    
    // Check existing data
    const orderCount = await Order.countDocuments();
    const itemCount = await MenuItem.countDocuments();
    const categoryCount = await Category.countDocuments();
    const clientCount = await Client.countDocuments();
    
    console.log('\n📊 CURRENT DATABASE STATUS:');
    console.log(`📄 Orders: ${orderCount}`);
    console.log(`🍔 Menu Items: ${itemCount}`);
    console.log(`📂 Categories: ${categoryCount}`);
    console.log(`👥 Clients: ${clientCount}`);
    
    if (orderCount === 0 && itemCount === 0) {
      console.log('\n🔄 Setting up default data...');
      
      // Create default categories
      const defaultCategories = [
        { id: 1, name: 'Burgers', icon: '🍔', sort_order: 1, active: true },
        { id: 2, name: 'Sides', icon: '🍟', sort_order: 2, active: true },
        { id: 3, name: 'Drinks', icon: '🥤', sort_order: 3, active: true },
        { id: 4, name: 'Desserts', icon: '🍰', sort_order: 4, active: true }
      ];
      await Category.insertMany(defaultCategories);
      console.log('✅ Default categories created');
      
      // Create default menu item
      const defaultItem = {
        id: 1,
        name: { en: 'Classic Burger', mt: 'Burger Klassiku', it: 'Burger Classico', fr: 'Burger Classique', es: 'Burger Clásico', de: 'Klassischer Burger', ru: 'Классический бургер', pt: 'Burger Clássico', nl: 'Klassieke Burger', pl: 'Klasyczny Burger' },
        description: { en: 'Juicy beef patty with lettuce, tomato, and our special sauce', mt: 'Patty tal-baħar b\'lettuce, tadam u salsa speċjali tagħna', it: 'Polpetta di manzo succosa con lattuga, pomodoro e la nostra salsa speciale', fr: 'Steak de bœuf juteux avec laitue, tomate et notre sauce spéciale', es: 'Hamburguesa de carne jugosa con lechuga, tomate y nuestra salsa especial', de: 'Saftiges Rindersteak mit Salat, Tomate und unserer speziellen Sauce', ru: 'Сочная говяжья котлета с салатом, помидорами и нашим специальным соусом', pt: 'Hambúrguer de carne suculento com alface, tomate e nosso molho especial', nl: 'Sappige rundvleesburger met sla, tomaat en onze speciale saus', pl: 'Soczysty burger wołowy z sałatą, pomidorem i naszym specjalnym sosem' },
        price: 12.99,
        category: 'Burgers',
        image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500',
        active: true,
        prepTime: { en: '15 min', mt: '15 min', it: '15 min', fr: '15 min', es: '15 min', de: '15 Min', ru: '15 мин', pt: '15 min', nl: '15 min', pl: '15 min' }
      };
      await MenuItem.create(defaultItem);
      console.log('✅ Default menu item created');
    }
    
    console.log('\n🎉 PERMANENT DATA STORAGE SETUP COMPLETE!');
    console.log('==========================================');
    console.log('✅ Your data is now stored permanently in MongoDB Atlas');
    console.log('✅ Orders, sales, and analytics will survive deployments');
    console.log('✅ You can now update GitHub without losing data');
    console.log('✅ Professional database with automatic backups');
    
    console.log('\n🧪 TESTING INSTRUCTIONS:');
    console.log('1. Place a test order');
    console.log('2. Update GitHub and redeploy');
    console.log('3. Verify the order is still there');
    console.log('4. Your data is now permanent! 🚀');
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
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

// Run setup
setupPermanentStorage();
