import type { NamingStrategyInterface } from 'typeorm';
import { DefaultNamingStrategy } from 'typeorm';

function snakeCase(str: string): string {
  return str
    .replaceAll(/([A-Z])([A-Z])([a-z])/g, '$1_$2$3')
    .replaceAll(/([\da-z])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

export class SnakeNamingStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  override tableName(
    entityName: string,
    customName: string | undefined,
  ): string {
    return customName ?? snakeCase(entityName);
  }

  override columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    // The trailing '' is what puts the separator between the prefixes and the
    // column: ['address'] + 'city' has to read address_city, and a custom name
    // still goes through untouched.
    return (
      snakeCase([...embeddedPrefixes, ''].join('_')) +
      (customName ?? snakeCase(propertyName))
    );
  }

  override relationName(propertyName: string): string {
    return snakeCase(propertyName);
  }

  override joinColumnName(
    relationName: string,
    referencedColumnName: string,
  ): string {
    return snakeCase(`${relationName}_${referencedColumnName}`);
  }

  override joinTableName(
    firstTableName: string,
    secondTableName: string,
    firstPropertyName: string,
    _secondPropertyName: string,
  ): string {
    return snakeCase(
      `${firstTableName}_${firstPropertyName.replaceAll(
        /\./gi,
        '_',
      )}_${secondTableName}`,
    );
  }

  override joinTableColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string,
  ): string {
    return snakeCase(`${tableName}_${columnName ?? propertyName}`);
  }
}
