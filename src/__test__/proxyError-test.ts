import { GraphQLError } from 'graphql';
import { testJoin } from './testUtils';

describe('proxy errors', () => {
  const execute = testJoin({
    test: `
      type Query { foo: Bar }
      type Bar { bar: String }
    `,
  },'schema { query: Query }');

  test('global error', async () => {
    await execute({
      query: '{ foo { bar } }',
      results: { test: {
        errors: [ new GraphQLError('global error') ],
      }},
    });
  });
  test('multiple global errors', async () => {
    await execute({
      query: '{ foo { bar } }',
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
      query: '{ foo { bar } }',
      rootValues: { test: {
        foo: {
          bar: new Error('error with path'),
        },
      }},
    });
  });

});
