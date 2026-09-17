import Dexie,{type Table} from 'dexie';
import type {Dependent,Fact,FactRelationship} from '../domain/core';
import type {DocumentRecord} from '../service/documents-service';

export interface FactsCacheState{
 key:'main';dependent:Dependent|null;facts:Fact[];relationships:FactRelationship[];documents:DocumentRecord[];updatedAt:string;
}

export class FactsCache extends Dexie{
 state!:Table<FactsCacheState,string>;
 constructor(userId:string){super('facts-cache-v2-'+userId);this.version(1).stores({state:'key'});}
 async read():Promise<FactsCacheState|undefined>{return this.state.get('main');}
 async write(input:Omit<FactsCacheState,'key'|'updatedAt'>):Promise<void>{await this.state.put({key:'main',...input,updatedAt:new Date().toISOString()});}
}
