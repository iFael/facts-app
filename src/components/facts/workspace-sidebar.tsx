'use client';

import {ArrowLeftRight,BarChart3,Clock3,Files,House,Landmark,Rows3} from 'lucide-react';
import {ThemeSwitch} from '@/components/facts/theme-switch';
import {
 Sidebar,SidebarContent,SidebarFooter,SidebarGroup,SidebarGroupContent,
 SidebarHeader,SidebarMenu,SidebarMenuButton,SidebarMenuItem,SidebarRail,SidebarTrigger,useSidebar
} from '@/components/ui/sidebar';

export type WorkspaceTab='home'|'bank'|'statement'|'facts'|'requests'|'documents'|'reports'|'data';

type Props={tab:WorkspaceTab;onTabChange:(tab:WorkspaceTab)=>void;dependentName?:string};

const items=[
 {id:'home' as const,label:'Início',icon:House},
 {id:'statement' as const,label:'Extrato',icon:Landmark},
 {id:'bank' as const,label:'Conciliação',icon:ArrowLeftRight},
 {id:'facts' as const,label:'Fatos',icon:Rows3},
 {id:'requests' as const,label:'Solicitações',icon:Clock3},
 {id:'documents' as const,label:'Documentos',icon:Files},
 {id:'reports' as const,label:'Relatórios',icon:BarChart3},
];

export function WorkspaceSidebar({tab,onTabChange,dependentName}:Props){
 const {state}=useSidebar(),displayName=dependentName?.trim()||'Seu dependente';
 const initial=displayName.charAt(0).toUpperCase()||'F',toggleLabel=state==='collapsed'?'Expandir menu':'Recolher menu';
 return <Sidebar collapsible="icon" className="border-r border-sidebar-border/80">
  <SidebarHeader className="p-3">
   <div className="flex h-12 items-center justify-between gap-2 px-1">
    <button type="button" aria-label="Ir para o início" onClick={()=>onTabChange('home')} className="flex min-w-0 items-center rounded-xl text-left outline-none transition-opacity hover:opacity-75 focus-visible:ring-2 focus-visible:ring-sidebar-ring">
     <img src="/icon.svg" width="34" height="34" alt="" className="size-8 shrink-0 rounded-xl"/>
    </button>
    <div className="group-data-[collapsible=icon]:hidden"><ThemeSwitch/></div>
   </div>
  </SidebarHeader>
  <SidebarContent>
   <div className="flex px-3 pt-1 group-data-[collapsible=icon]:justify-center"><SidebarTrigger aria-label={toggleLabel} title={toggleLabel} className="text-muted-foreground hover:text-foreground"/></div>
   <SidebarGroup className="pt-1"><SidebarGroupContent><SidebarMenu>
    {items.map(({id,label,icon:Icon})=><SidebarMenuItem key={id}><SidebarMenuButton isActive={tab===id} tooltip={label} onClick={()=>onTabChange(id)} className="h-10 rounded-lg transition-colors"><Icon/><span>{label}</span></SidebarMenuButton></SidebarMenuItem>)}
   </SidebarMenu></SidebarGroupContent></SidebarGroup>
  </SidebarContent>
  <SidebarFooter className="p-3">
   <button type="button" aria-label="Meus dados" onClick={()=>onTabChange('data')} className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-colors group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0 ${tab==='data'?'border-sidebar-border bg-sidebar-accent':'border-sidebar-border/80 bg-background/70 hover:bg-sidebar-accent'}`}>
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initial}</span>
    <span className="min-w-0 truncate text-sm font-semibold text-foreground group-data-[collapsible=icon]:hidden">{displayName}</span>
   </button>
  </SidebarFooter>
  <SidebarRail/>
 </Sidebar>;
}
