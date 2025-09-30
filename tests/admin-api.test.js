/**
 * Admin API Tests
 * 
 * Tests for menu items and categories CRUD operations
 * Run with: npm test
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/server');

// Test database
const TEST_DB_URI = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/aroma-restaurant-test';

describe('Admin API Tests', () => {
  let server;
  
  beforeAll(async () => {
    // Connect to test database
    await mongoose.connect(TEST_DB_URI);
    
    // Start server
    server = app.listen(0); // Use random port for testing
  });
  
  afterAll(async () => {
    // Clean up
    if (server) {
      server.close();
    }
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });
  
  beforeEach(async () => {
    // Clear test data before each test
    await mongoose.connection.db.dropDatabase();
  });
  
  describe('Categories API', () => {
    test('GET /api/menu/categories should return categories with proper names', async () => {
      // Create test category
      const Category = mongoose.model('Category', new mongoose.Schema({
        id: Number,
        name: mongoose.Schema.Types.Mixed,
        icon: String,
        sort_order: Number,
        active: Boolean
      }));
      
      await Category.create({
        id: 1,
        name: { en: 'Burgers', es: 'Hamburguesas' },
        icon: '🍔',
        sort_order: 1,
        active: true
      });
      
      const response = await request(app)
        .get('/api/menu/categories')
        .expect(200);
      
      expect(response.body).toHaveProperty('categories');
      expect(response.body.categories).toHaveLength(1);
      expect(response.body.categories[0]).toHaveProperty('name');
      expect(response.body.categories[0].name).toHaveProperty('en', 'Burgers');
    });
    
    test('POST /api/menu/categories should create category with multilingual name', async () => {
      const categoryData = {
        name: 'Test Category',
        icon: '🍽️',
        sort_order: 1
      };
      
      const response = await request(app)
        .post('/api/menu/categories')
        .send(categoryData)
        .expect(200);
      
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('category');
      expect(response.body.category).toHaveProperty('name');
      expect(typeof response.body.category.name).toBe('object');
      expect(response.body.category.name).toHaveProperty('en', 'Test Category');
    });
  });
  
  describe('Menu Items API', () => {
    test('GET /api/menu should return items with proper category names', async () => {
      // Create test category and item
      const Category = mongoose.model('Category', new mongoose.Schema({
        id: Number,
        name: mongoose.Schema.Types.Mixed,
        icon: String,
        sort_order: Number,
        active: Boolean
      }));
      
      const MenuItem = mongoose.model('MenuItem', new mongoose.Schema({
        id: Number,
        name: mongoose.Schema.Types.Mixed,
        description: mongoose.Schema.Types.Mixed,
        price: Number,
        category_id: Number,
        image: String,
        active: Boolean
      }));
      
      await Category.create({
        id: 1,
        name: { en: 'Burgers', es: 'Hamburguesas' },
        icon: '🍔',
        sort_order: 1,
        active: true
      });
      
      await MenuItem.create({
        id: 1,
        name: { en: 'Test Burger', es: 'Hamburguesa de Prueba' },
        description: { en: 'A test burger', es: 'Una hamburguesa de prueba' },
        price: 12.99,
        category_id: 1,
        image: 'test.jpg',
        active: true
      });
      
      const response = await request(app)
        .get('/api/menu')
        .expect(200);
      
      expect(response.body).toHaveProperty('items');
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0]).toHaveProperty('name');
      expect(response.body.items[0].name).toHaveProperty('en', 'Test Burger');
    });
    
    test('POST /api/menu/items should create item with multilingual fields', async () => {
      // Create test category first
      const Category = mongoose.model('Category', new mongoose.Schema({
        id: Number,
        name: mongoose.Schema.Types.Mixed,
        icon: String,
        sort_order: Number,
        active: Boolean
      }));
      
      await Category.create({
        id: 1,
        name: { en: 'Burgers', es: 'Hamburguesas' },
        icon: '🍔',
        sort_order: 1,
        active: true
      });
      
      const itemData = {
        name: 'Test Item',
        description: 'A test item',
        price: 9.99,
        category_id: 1,
        image: 'test.jpg'
      };
      
      const response = await request(app)
        .post('/api/menu/items')
        .send(itemData)
        .expect(200);
      
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('item');
      expect(response.body.item).toHaveProperty('name');
      expect(typeof response.body.item.name).toBe('object');
      expect(response.body.item.name).toHaveProperty('en', 'Test Item');
    });
  });
  
  describe('Category Name Rendering', () => {
    test('Categories should not render as [object Object]', async () => {
      const Category = mongoose.model('Category', new mongoose.Schema({
        id: Number,
        name: mongoose.Schema.Types.Mixed,
        icon: String,
        sort_order: Number,
        active: Boolean
      }));
      
      // Create category with multilingual name
      await Category.create({
        id: 1,
        name: { en: 'Burgers', es: 'Hamburguesas', fr: 'Hamburgers' },
        icon: '🍔',
        sort_order: 1,
        active: true
      });
      
      const response = await request(app)
        .get('/api/menu/categories')
        .expect(200);
      
      const category = response.body.categories[0];
      
      // Verify the name is an object, not a string representation
      expect(typeof category.name).toBe('object');
      expect(category.name).toHaveProperty('en', 'Burgers');
      expect(category.name).toHaveProperty('es', 'Hamburguesas');
      
      // Verify it's not the string "[object Object]"
      expect(JSON.stringify(category.name)).not.toContain('[object Object]');
    });
  });
});
