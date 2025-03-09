import { Sequelize } from 'sequelize';
import dbConfig from '../config/config.cjs';

const sequelize = new Sequelize(
  dbConfig.development.database,
  dbConfig.development.username,
  dbConfig.development.password,
  {
    host: dbConfig.development.host,
    dialect: dbConfig.development.dialect,
    logging: false
  }
);

export { sequelize };
export default sequelize;
