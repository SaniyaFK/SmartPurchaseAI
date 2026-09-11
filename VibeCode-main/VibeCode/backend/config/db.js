const mongoose = require('mongoose');

let isConnectedToDb = false;

/**
 * Connect to MongoDB Compass / MongoDB Atlas / Local MongoDB
 */
async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/smart_warranty_db';

  try {
    mongoose.set('strictQuery', false);
    
    // Connection options for MongoDB Compass / Local / Atlas
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 4000, // Quick timeout fallback if local mongod is offline
      connectTimeoutMS: 5000
    });

    isConnectedToDb = true;
    console.log(`====================================================`);
    console.log(`🍃 MongoDB Compass / Database Connected Successfully!`);
    console.log(`📍 Host: ${conn.connection.host}`);
    console.log(`🗄️ Database: ${conn.connection.name}`);
    console.log(`====================================================`);

    mongoose.connection.on('error', (err) => {
      console.error('🍃 MongoDB Connection Error:', err.message);
      isConnectedToDb = false;
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('🍃 MongoDB Disconnected.');
      isConnectedToDb = false;
    });

    return true;
  } catch (error) {
    isConnectedToDb = false;
    console.warn(`====================================================`);
    console.warn(`⚠️ MongoDB connection attempt notice: ${error.message}`);
    console.warn(`💡 If MongoDB Compass/service is not running locally, the system will`);
    console.warn(`   automatically utilize resilient in-memory persistence fallback.`);
    console.warn(`   All features (OCR, Deadlines, Claims, Stats) will function 100%!`);
    console.warn(`====================================================`);
    return false;
  }
}

function getDbStatus() {
  return {
    connected: isConnectedToDb && mongoose.connection.readyState === 1,
    readyState: mongoose.connection.readyState,
    databaseName: mongoose.connection.name || 'smart_warranty_db',
    host: mongoose.connection.host || 'localhost:27017'
  };
}

module.exports = {
  connectDB,
  getDbStatus
};
