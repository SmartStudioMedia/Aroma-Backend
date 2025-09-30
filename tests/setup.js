/**
 * Test Setup
 * 
 * Global test configuration and setup
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.TEST_MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/aroma-restaurant-test';

// Increase timeout for database operations
jest.setTimeout(10000);
