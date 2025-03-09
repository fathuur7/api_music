module.exports = {
  development: {
    username: "root",
    password: "",
    database: "my_music_db_development",
    host: "127.0.0.1",
    dialect: "mysql"
  },
  test: {
    username: "root",
    password: "password_db",
    database: "nama_database_test",
    host: "127.0.0.1",
    dialect: "mysql"
  },
  production: {
    username: "root",
    password: "password_db",
    database: "my_music_db",
    host: "127.0.0.1",
    dialect: "mysql"
  }
};
