import {expect,it} from 'vitest';
import {evidenceSchema} from './core';

const base={
 id:'22000000-0000-4000-8000-000000000001',
 attachmentId:'22000000-0000-4000-8000-000000000002',
 source:'document' as const,
 createdAt:'2026-09-14T21:55:00.000Z'
};

it('Evidence não aceita o mesmo fato duas vezes',()=>{
 const factId='22000000-0000-4000-8000-000000000003';
 expect(()=>evidenceSchema.parse({...base,factIds:[factId,factId]})).toThrow('duplicados');
 expect(evidenceSchema.parse({...base,factIds:[factId]}).factIds).toEqual([factId]);
});
