import {describe,it,expect} from 'vitest';
import {authorisedPages} from './presentation';
describe('presentation navigation',()=>{
 it('shows arrival only for intake-only staff',()=>expect(authorisedPages(['arrival.register']).map(p=>p[0])).toEqual(['arrival']));
 it('shows no clinical pages to an unprivileged context',()=>expect(authorisedPages([])).toEqual([]));
 it('requires companion permissions for queue and reviews',()=>expect(authorisedPages(['queue.read','exception.review'])).toEqual([]));
 it('does not infer clinical authority from administration',()=>expect(authorisedPages(['membership.manage']).map(p=>p[0])).toEqual(['admin']));
});
