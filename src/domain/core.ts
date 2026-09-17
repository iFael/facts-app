import {z} from 'zod';

export const categories={alimentacao:'Alimentação',saude:'Saúde',vestuario:'Vestuário',transporte:'Transporte',higiene:'Higiene',educacao:'Educação',lazer:'Lazer',outros:'Outros'} as const;
export const categorySchema=z.enum(Object.keys(categories) as [keyof typeof categories,...Array<keyof typeof categories>]);
export const factSourceSchema=z.enum(['chat','ui','document','import']);
export const actorSchema=z.enum(['user','assistant']);
export const provenanceKindSchema=z.enum(['user_assertion','assistant_interpretation','evidence_derived','imported']);
export const entityTypeSchema=z.enum(['dependent','fact','evidence','attachment','relationship']);
export const moneyCentsSchema=z.number().int().min(1).max(99999999999);

export function validDate(value:string):boolean{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T12:00:00Z');
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export const civilDateSchema=z.string().refine(validDate,'Data inválida');

export const dependentSchema=z.object({
 id:z.uuid(),
 name:z.string().trim().min(1).max(100),
 birthDate:civilDateSchema.optional(),
 createdAt:z.iso.datetime(),
 updatedAt:z.iso.datetime()
}).strict();
export type Dependent=z.infer<typeof dependentSchema>;

const factBaseSchema=z.object({
 id:z.uuid(),
 dependentId:z.uuid(),
 title:z.string().trim().min(1).max(160),
 category:categorySchema,
 notes:z.string().max(10000),
 occurredAt:civilDateSchema,
 source:factSourceSchema,
 sourceDetail:z.string().trim().min(1).max(100).optional(),
 createdBy:actorSchema,
 provenanceKind:provenanceKindSchema,
 createdAt:z.iso.datetime(),
 updatedAt:z.iso.datetime()
});

export const expenseSchema=factBaseSchema.extend({kind:z.literal('expense'),amountCents:moneyCentsSchema}).strict();
export const paymentSchema=factBaseSchema.extend({kind:z.literal('payment'),amountCents:moneyCentsSchema}).strict();
export const transferSchema=factBaseSchema.extend({kind:z.literal('transfer'),amountCents:moneyCentsSchema,transferPurpose:z.enum(['pensao','adicional','reembolso'])}).strict();
export const requestSchema=factBaseSchema.extend({kind:z.literal('request'),amountCents:moneyCentsSchema,requestTotalCents:moneyCentsSchema.optional()}).strict();
export const eventSchema=factBaseSchema.extend({kind:z.literal('event')}).strict();

export const factSchema=z.discriminatedUnion('kind',[expenseSchema,paymentSchema,transferSchema,requestSchema,eventSchema]).superRefine((fact,ctx)=>{
 if(fact.kind==='request'&&fact.requestTotalCents!==undefined&&fact.requestTotalCents<fact.amountCents){
  ctx.addIssue({code:'custom',path:['requestTotalCents'],message:'O total deve ser maior ou igual ao valor solicitado.'});
 }
});
export type Fact=z.infer<typeof factSchema>;

export const attachmentSchema=z.object({
 id:z.uuid(),
 name:z.string().trim().min(1).max(255),
 mime:z.string().trim().min(1).max(150),
 size:z.number().int().positive().max(20*1024*1024),
 sha256:z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export type Attachment=z.infer<typeof attachmentSchema>;

export const evidenceInterpretationSchema=z.object({
 documentType:z.string().trim().min(1).max(160),
 suggestedKind:z.enum(['expense','payment','transfer','request','event']).optional(),
 suggestedCategory:categorySchema.optional(),
 values:z.array(z.object({cents:moneyCentsSchema,label:z.string().max(120),context:z.string().max(500)}).strict()).max(200),
 dates:z.array(civilDateSchema).max(100),
 createdAt:z.iso.datetime()
}).strict();
export type EvidenceInterpretation=z.infer<typeof evidenceInterpretationSchema>;

export const evidenceSchema=z.object({
 id:z.uuid(),
 attachmentId:z.uuid(),
 factIds:z.array(z.uuid()).max(100).refine(ids=>new Set(ids).size===ids.length,'factIds duplicados não são permitidos.'),
 source:z.enum(['document','import']),
 extractedText:z.string().max(1_000_000).optional(),
 interpretation:evidenceInterpretationSchema.optional(),
 createdAt:z.iso.datetime()
}).strict();
export type Evidence=z.infer<typeof evidenceSchema>;

export const factRelationshipSchema=z.object({
 id:z.uuid(),
 kind:z.literal('fulfills_request'),
 factId:z.uuid(),
 requestId:z.uuid(),
 createdAt:z.iso.datetime()
}).strict().refine(relationship=>relationship.factId!==relationship.requestId,{message:'O desembolso e a solicitação devem ser fatos distintos.'});
export type FactRelationship=z.infer<typeof factRelationshipSchema>;

export function validateFactRelationship(input:unknown,facts:readonly Fact[]):FactRelationship{
 const relationship=factRelationshipSchema.parse(input);
 const disbursement=facts.find(fact=>fact.id===relationship.factId);
 if(!disbursement||!['expense','payment','transfer'].includes(disbursement.kind))throw new Error('O vínculo exige um desembolso válido.');
 const request=facts.find(fact=>fact.id===relationship.requestId);
 if(!request||request.kind!=='request')throw new Error('O vínculo exige uma solicitação válida.');
 return relationship;
}

export const mutationSchema=z.object({
 mutationId:z.uuid(),
 operation:z.string().trim().min(1).max(80),
 entityType:entityTypeSchema,
 entityId:z.uuid(),
 source:factSourceSchema,
 createdBy:actorSchema,
 createdAt:z.iso.datetime()
}).strict();
export type Mutation=z.infer<typeof mutationSchema>;

export const auditEntrySchema=z.object({
 id:z.uuid(),
 mutationId:z.uuid(),
 entityType:entityTypeSchema,
 entityId:z.uuid(),
 action:z.enum(['create','update','delete','link','unlink']),
 source:factSourceSchema,
 createdBy:actorSchema,
 changedAt:z.iso.datetime(),
 before:z.unknown().nullable(),
 after:z.unknown().nullable()
}).strict();
export type AuditEntry=z.infer<typeof auditEntrySchema>;
