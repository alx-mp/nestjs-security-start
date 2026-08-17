import { describe, expect, it } from 'vitest';

import { SnakeNamingStrategy } from './snake-naming.strategy';

describe('SnakeNamingStrategy', () => {
  const strategy = new SnakeNamingStrategy();

  it('snake-cases a plain column', () => {
    expect(strategy.columnName('courseId', undefined, [])).toBe('course_id');
  });

  it('separates an embedded prefix from the column name', () => {
    expect(strategy.columnName('city', undefined, ['address'])).toBe(
      'address_city',
    );
  });

  it('keeps a custom column name behind the prefix', () => {
    expect(strategy.columnName('city', 'town', ['address'])).toBe(
      'address_town',
    );
  });

  it('snake-cases the entity name into a table name', () => {
    expect(strategy.tableName('UserSession', undefined)).toBe('user_session');
    expect(strategy.tableName('UserSession', 'user_sessions')).toBe(
      'user_sessions',
    );
  });
});
