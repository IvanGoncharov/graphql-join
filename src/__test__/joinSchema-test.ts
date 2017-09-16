import { testJoin } from './testUtils';

describe('joinSchema', () => {

  test('Prefix remote types', async () => {
    const execute = testJoin(
      {
        test: {
          sdl: `
            type Query { foo: BarOrBaz }
            union BarOrBaz = Bar | Baz
            type Bar { bar: String }
            type Baz { baz: String }
          `,
          prefix: 'PrEfIx_'
        },
      },
      'schema { query: PrEfIx_Query }'
    );

    execute(`
      {
        foo {
          ... on PrEfIx_Bar { bar }
          ... on PrEfIx_Baz { baz }
        }
      }
    `);
  });

});
