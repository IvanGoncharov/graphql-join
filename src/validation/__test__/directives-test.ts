import { parse } from 'graphql';
import { validateJoinIDL } from '../validate';

function snapshotsErrors(idl: string) {
  expect(validateJoinIDL(parse(idl))).toMatchSnapshot();
}

describe('validate directives', () => {
  test('unknown directives', () => {
    snapshotsErrors(`
      type Query {
        foo: String @unknown
      }
    `);
  });

  test('missing required argument', () => {
    snapshotsErrors(`
      type Query {
        foo: String @resolveWith
      }
    `);
  });
});
