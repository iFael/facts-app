'use client';
import {LogOut,UserRound} from 'lucide-react';
import type {Dependent} from '../../domain/core';
import type {DocumentRecord} from '../../service/documents-service';
import {dateLabel} from '../../domain/view';
import {supabase} from '../../lib/supabase/client';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';

export function DataPanel({dependent,documents}:{dependent:Dependent;documents:DocumentRecord[]}){
 const storageMb=(documents.reduce((sum,item)=>sum+item.attachment.size,0)/1024/1024).toFixed(1);
 return <section className="grid gap-4 xl:grid-cols-2">
  <Card><CardHeader><div className="mb-1 grid size-9 place-items-center rounded-lg bg-muted"><UserRound className="size-4"/></div><CardTitle>Dependente</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm"><div><span className="text-muted-foreground">Nome</span><p className="font-medium">{dependent.name}</p></div>{dependent.birthDate&&<div><span className="text-muted-foreground">Nascimento</span><p className="font-medium">{dateLabel(dependent.birthDate)}</p></div>}</CardContent></Card>
  <Card><CardHeader><CardTitle>Conta</CardTitle></CardHeader><CardContent className="grid gap-4 text-sm"><div><span className="text-muted-foreground">Documentos armazenados</span><p className="font-medium">{documents.length} · {storageMb} MB</p></div><Button className="w-fit" variant="outline" onClick={()=>void supabase.auth.signOut().then(()=>{localStorage.removeItem('facts-last-user');window.location.reload();})}><LogOut data-icon="inline-start"/>Sair da conta</Button></CardContent></Card>
 </section>;
}
