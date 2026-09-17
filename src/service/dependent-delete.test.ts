import {expect,it} from 'vitest';
import {FactsService,type FactsRepository} from './facts-service.ts';

it('exclui dependente delegando mutationId validada ao repositório',async()=>{
 const calls:unknown[]=[];
 const repository={
  deleteDependent:async(context:unknown,id:string)=>{calls.push({context,id});return {id,deleted:true as const};}
 } as unknown as FactsRepository;
 const service=new FactsService(repository);
 const mutationId='40000000-0000-4000-8000-000000000001';
 const dependentId='40000000-0000-4000-8000-000000000002';
 await expect(service.deleteDependent({mutationId,source:'chat',createdBy:'assistant'},dependentId)).resolves.toEqual({id:dependentId,deleted:true});
 expect(calls).toEqual([{context:{mutationId,source:'chat',createdBy:'assistant'},id:dependentId}]);
});
