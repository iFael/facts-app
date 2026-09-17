'use client';

import {useState} from 'react';
import {BarChart3,Clock3,Database,Files,House,Landmark,Menu,Rows3} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Drawer,DrawerContent,DrawerDescription,DrawerHeader,DrawerTitle} from '@/components/ui/drawer';
import type {WorkspaceTab} from './workspace-sidebar';

type Props={tab:WorkspaceTab;onTabChange:(tab:WorkspaceTab)=>void};

export function MobileNavigation({tab,onTabChange}:Props){
 const [moreOpen,setMoreOpen]=useState(false);
 const choose=(next:WorkspaceTab)=>{onTabChange(next);setMoreOpen(false);};
 return <>
  <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-border bg-background/95 px-2 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
   <NavButton active={tab==='home'} label="Início" icon={<House/>} onClick={()=>choose('home')}/>
   <NavButton active={tab==='statement'} label="Extrato" icon={<Landmark/>} onClick={()=>choose('statement')}/>
   <NavButton active={tab==='facts'} label="Fatos" icon={<Rows3/>} onClick={()=>choose('facts')}/>
   <NavButton active={['requests','documents','reports','data'].includes(tab)} label="Mais" icon={<Menu/>} onClick={()=>setMoreOpen(true)}/>
  </nav>
  <Drawer open={moreOpen} onOpenChange={setMoreOpen} showSwipeHandle>
   <DrawerContent>
    <DrawerHeader className="text-left"><DrawerTitle>Mais</DrawerTitle><DrawerDescription>Outras áreas do seu histórico.</DrawerDescription></DrawerHeader>
    <div className="grid gap-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
     <MoreButton active={tab==='requests'} icon={<Clock3/>} label="Solicitações" onClick={()=>choose('requests')}/>
     <MoreButton active={tab==='documents'} icon={<Files/>} label="Documentos" onClick={()=>choose('documents')}/>
     <MoreButton active={tab==='reports'} icon={<BarChart3/>} label="Relatórios" onClick={()=>choose('reports')}/>
     <MoreButton active={tab==='data'} icon={<Database/>} label="Meus dados" onClick={()=>choose('data')}/>
    </div>
   </DrawerContent>
  </Drawer>
 </>;
}

function NavButton({active,label,icon,onClick}:{active:boolean;label:string;icon:React.ReactNode;onClick:()=>void}){
 return <Button variant="ghost" className={active?'h-12 flex-col gap-1 text-foreground':'h-12 flex-col gap-1 text-muted-foreground'} onClick={onClick}>{icon}<span className="text-[10px]">{label}</span></Button>;
}

function MoreButton({active,label,icon,onClick}:{active:boolean;label:string;icon:React.ReactNode;onClick:()=>void}){
 return <Button variant={active?'secondary':'ghost'} className="h-12 justify-start gap-3" onClick={onClick}>{icon}<span>{label}</span></Button>;
}
