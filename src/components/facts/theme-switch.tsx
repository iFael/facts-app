'use client';

import {useEffect,useState} from 'react';
import {Moon} from 'lucide-react';
import {useTheme} from 'next-themes';
import {Switch} from '@/components/ui/switch';

export function ThemeSwitch(){
 const {theme,setTheme}=useTheme();
 const [mounted,setMounted]=useState(false);
 useEffect(()=>setMounted(true),[]);
 const dark=mounted&&theme==='dark';
 return <div className="flex min-h-11 items-center gap-2" title="Modo escuro">
  <Switch aria-label="Modo escuro" size="sm" className="after:-inset-y-[15px]" checked={dark} onCheckedChange={checked=>setTheme(checked?'dark':'light')}/>
  <Moon className="size-3.5 text-muted-foreground group-data-[collapsible=icon]:hidden" aria-hidden="true"/>
 </div>;
}
