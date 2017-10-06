import { GraphQLError } from 'graphql';
import { testJoin } from './testUtils';

describe('proxy errors', () => {
  const execute = testJoin({
    test: `
      type Query { fooBar: Bar, fooBaz: Baz }
      type Bar { bar: String }
      type Baz { baz: String }
    `,
  },'schema { query: Query }');

  test('global error', async () => {
    await execute({
      query: `
        {
          fooBar { bar }
          fooBaz { baz }
        }
      `,
      results: { test: {
        errors: [ new GraphQLError('global error') ],
      }},
    });
  });
  test('multiple global errors', async () => {
    await execute({
      query: `
        {
          fooBar { bar }
          fooBaz { baz }
        }
      `,
      results: { test: {
        errors: [
          new GraphQLError('first global error'),
          new GraphQLError('second global error')
        ],
      }},
    });
  });
  test('error with path', async () => {
    await execute({
      query: `
        {
          fooBar { bar }
          fooBaz { baz }
        }
      `,
      rootValues: { test: {
        fooBar: {
          bar: new Error('bar error'),
        },
        fooBaz: {
          baz: new Error('baz error'),
        },
      }},
    });
  });

});
