# Restaurant Backend API

A professional restaurant management system with admin dashboard, menu management, order processing, and customer management.

## Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: MongoDB with Mongoose ODM
- **Template Engine**: EJS
- **Authentication**: Basic Auth
- **Email**: SendGrid
- **Payment**: Stripe
- **Testing**: Jest, Supertest

## Features

- 🍽️ **Menu Management**: Full CRUD operations for menu items and categories
- 📊 **Admin Dashboard**: Real-time analytics and order management
- 🛒 **Order Processing**: Complete order lifecycle management
- 👥 **Customer Management**: Marketing consent and customer tracking
- 🌍 **Multilingual Support**: Automatic translation for menu items and categories
- 📧 **Email Notifications**: Order confirmations and updates
- 💳 **Payment Integration**: Stripe payment processing
- 📱 **QR Code Generation**: Table QR codes for easy ordering

## Database Setup

### Environment Variables

Create a `.env` file in the root directory:

```bash
# Database
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/aroma-restaurant

# Authentication
ADMIN_USER=admin
ADMIN_PASS=your_secure_password
KITCHEN_USER=kitchen
KITCHEN_PASS=your_kitchen_password

# Email (SendGrid)
SENDGRID_API_KEY=your_sendgrid_api_key
FROM_EMAIL=noreply@yourrestaurant.com

# Payment (Stripe)
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key

# Server
PORT=4000
```

### MongoDB Atlas Setup

1. **Create MongoDB Atlas Account**
   - Go to [MongoDB Atlas](https://www.mongodb.com/atlas)
   - Sign up for a free account
   - Create a new cluster (choose FREE tier)

2. **Configure Database Access**
   - Go to "Database Access" → "Add New Database User"
   - Username: `aroma-admin`
   - Password: Generate a strong password
   - Database User Privileges: "Read and write to any database"

3. **Configure Network Access**
   - Go to "Network Access" → "Add IP Address"
   - Choose "Allow access from anywhere" (0.0.0.0/0)

4. **Get Connection String**
   - Go to "Clusters" → "Connect" → "Connect your application"
   - Copy the connection string
   - Replace `<password>` with your actual password

### Database Migration

Run the migration script to set up the database:

```bash
# Install dependencies
npm install

# Run database migration and seeding
npm run migrate

# Or run manually
node scripts/migrate-db.js
```

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd restbackend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Run database migration
npm run migrate

# Start the server
npm start

# For development
npm run dev
```

## API Endpoints

### Menu Management
- `GET /api/menu` - Get all menu items and categories
- `POST /api/menu/items` - Create new menu item
- `PUT /api/menu/items/:id` - Update menu item
- `DELETE /api/menu/items/:id` - Delete menu item
- `POST /api/menu/categories` - Create new category
- `PUT /api/menu/categories/:id` - Update category
- `DELETE /api/menu/categories/:id` - Delete category

### Order Management
- `POST /api/orders` - Create new order
- `GET /api/orders` - Get all orders
- `PUT /api/orders/:id` - Update order status
- `DELETE /api/orders/:id` - Delete order

### Admin Dashboard
- `GET /admin` - Admin dashboard
- `GET /admin/items` - Menu items management
- `GET /admin/orders` - Orders management
- `GET /admin/clients` - Customer management

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test tests/admin-api.test.js
```

## Database Schema

### Categories
```javascript
{
  id: Number,
  name: {
    en: String,
    mt: String,
    es: String,
    // ... other languages
  },
  icon: String,
  sort_order: Number,
  active: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### Menu Items
```javascript
{
  id: Number,
  name: {
    en: String,
    mt: String,
    es: String,
    // ... other languages
  },
  description: Object, // Multilingual
  price: Number,
  category_id: Number,
  image: String,
  video: String,
  thumbnail: String,
  active: Boolean,
  ingredients: Object, // Multilingual
  nutrition: Object, // Multilingual
  allergies: Object, // Multilingual
  prepTime: Object, // Multilingual
  createdAt: Date,
  updatedAt: Date
}
```

### Orders
```javascript
{
  id: Number,
  items: [{
    id: Number,
    name: Object, // Multilingual
    price: Number,
    quantity: Number,
    category_id: Number
  }],
  customerName: String,
  customerEmail: String,
  orderType: String,
  tableNumber: String,
  marketingConsent: Boolean,
  total: Number,
  discount: Number,
  status: String,
  createdAt: Date,
  updatedAt: Date
}
```

### Clients
```javascript
{
  id: Number,
  name: String,
  email: String,
  marketingConsent: Boolean,
  totalOrders: Number,
  totalSpent: Number,
  createdAt: Date,
  updatedAt: Date
}
```

## Deployment

### Railway Deployment

1. **Connect to Railway**
   ```bash
   npm install -g @railway/cli
   railway login
   railway link
   ```

2. **Set Environment Variables**
   ```bash
   railway variables set MONGODB_URI=your_mongodb_connection_string
   railway variables set ADMIN_PASS=your_secure_password
   railway variables set SENDGRID_API_KEY=your_sendgrid_key
   ```

3. **Deploy**
   ```bash
   railway up
   ```

### Manual Deployment

1. **Prepare Environment**
   ```bash
   # Set production environment variables
   export NODE_ENV=production
   export MONGODB_URI=your_mongodb_connection_string
   ```

2. **Run Migration**
   ```bash
   npm run migrate
   ```

3. **Start Application**
   ```bash
   npm start
   ```

## Data Persistence

The application ensures data persistence through:

- **Primary Storage**: MongoDB Atlas (cloud database)
- **Fallback Storage**: Local JSON files (development only)
- **Automatic Migration**: Converts file data to database on first run
- **Idempotent Operations**: Safe to run multiple times
- **Data Validation**: Ensures data integrity and consistency

## Multilingual Support

The system automatically generates translations for:
- Menu item names and descriptions
- Category names
- Ingredients, nutrition, and allergy information
- Preparation times

Supported languages: English, Maltese, Spanish, Italian, French, German, Russian, Portuguese, Dutch, Polish

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Check MONGODB_URI environment variable
   - Verify MongoDB Atlas cluster is running
   - Check network access settings

2. **Categories Show as [object Object]**
   - Run database migration: `npm run migrate`
   - Check template rendering logic

3. **Data Lost on Restart**
   - Ensure MONGODB_URI is set correctly
   - Check MongoDB Atlas connection
   - Verify data is being saved to database

### Debug Mode

Enable debug logging:
```bash
DEBUG=* npm start
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

## License

ISC License - see LICENSE file for details.

## Support

For support and questions:
- Check the troubleshooting section
- Review the API documentation
- Open an issue on GitHub
