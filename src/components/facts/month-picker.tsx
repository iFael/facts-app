'use client';

import {useMemo,useState} from 'react';
import {CalendarDays,ChevronLeft,ChevronRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Drawer,DrawerContent,DrawerDescription,DrawerHeader,DrawerTitle} from '@/components/ui/drawer';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {useIsMobile} from '@/hooks/use-mobile';

const months=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const longMonths=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

function parseMonth(value:string){
 const match=/^(\d{4})-(\d{2})$/.exec(value);
 if(!match)return null;
 const year=Number(match[1]),month=Number(match[2])-1;
 return month>=0&&month<12?{year,month}:null;
}

function monthValue(year:number,month:number){return `${year}-${String(month+1).padStart(2,'0')}`;}
function monthLabel(value:string){const parsed=parseMonth(value);return parsed?`${longMonths[parsed.month]} de ${parsed.year}`:'Selecionar período';}

interface MonthPickerProps{value:string;onChange:(value:string)=>void;label?:string;minYear?:number;maxYear?:number;}

export function MonthPicker({value,onChange,label='Período',minYear=2000,maxYear=new Date().getFullYear()+1}:MonthPickerProps){
 const isMobile=useIsMobile(),selected=parseMonth(value),[open,setOpen]=useState(false),[year,setYear]=useState(selected?.year??new Date().getFullYear());
 const years=useMemo(()=>Array.from({length:maxYear-minYear+1},(_,i)=>maxYear-i),[minYear,maxYear]);
 const choose=(month:number)=>{onChange(monthValue(year,month));setOpen(false);};
 const content=<div data-slot="month-picker-content" className="grid gap-4 p-2">
  <div className="flex items-center justify-between gap-2"><Button type="button" variant="ghost" size="icon-sm" aria-label="Ano anterior" disabled={year<=minYear} onClick={()=>setYear(y=>Math.max(minYear,y-1))}><ChevronLeft/></Button><Select value={String(year)} onValueChange={value=>setYear(Number(value))}><SelectTrigger aria-label="Ano" className="w-28"><SelectValue/></SelectTrigger><SelectContent>{years.map(item=><SelectItem key={item} value={String(item)}>{item}</SelectItem>)}</SelectContent></Select><Button type="button" variant="ghost" size="icon-sm" aria-label="Próximo ano" disabled={year>=maxYear} onClick={()=>setYear(y=>Math.min(maxYear,y+1))}><ChevronRight/></Button></div>
  <div className="grid grid-cols-3 gap-2">{months.map((month,index)=>{const active=selected?.year===year&&selected.month===index;return <Button type="button" key={month} variant={active?'default':'ghost'} className="h-10 capitalize" onClick={()=>choose(index)}>{month}</Button>;})}</div>
  <div className="flex justify-end"><Button type="button" variant="ghost" size="sm" onClick={()=>{const now=new Date();setYear(now.getFullYear());onChange(monthValue(now.getFullYear(),now.getMonth()));setOpen(false);}}>Este mês</Button></div>
 </div>;
 const trigger=<Button type="button" variant="outline" className="h-9 w-[195px] justify-between bg-background font-normal" aria-label={label}><span>{monthLabel(value)}</span><CalendarDays className="size-4 text-muted-foreground"/></Button>;

 if(isMobile)return <><Button data-slot="month-picker-trigger" type="button" variant="outline" className="h-11 w-[195px] justify-between bg-background font-normal" aria-label={label} onClick={()=>{setYear(selected?.year??new Date().getFullYear());setOpen(true);}}><span>{monthLabel(value)}</span><CalendarDays className="size-4 text-muted-foreground"/></Button><Drawer open={open} onOpenChange={setOpen} showSwipeHandle><DrawerContent><DrawerHeader className="text-left"><DrawerTitle>{label}</DrawerTitle><DrawerDescription>Escolha o mês e o ano dos registros.</DrawerDescription></DrawerHeader><div className="px-4 pb-5">{content}</div></DrawerContent></Drawer></>;

 return <Popover open={open} onOpenChange={next=>{if(next)setYear(selected?.year??new Date().getFullYear());setOpen(next);}}><PopoverTrigger data-slot="month-picker-trigger" aria-label={label} render={trigger}/><PopoverContent align="start" className="w-72 p-1">{content}</PopoverContent></Popover>;
}
