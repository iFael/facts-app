import type {Metadata,Viewport} from 'next';
import {ThemeProvider} from '@/components/facts/theme-provider';
import {TooltipProvider} from '@/components/ui/tooltip';
import './styles.css';

export const metadata:Metadata={
 title:'Facts',
 description:'Fatos, cuidados e registros em um só lugar.',
 manifest:'/manifest.webmanifest',
 icons:{icon:'/icon.svg',apple:'/apple-touch-icon.png'},
 appleWebApp:{capable:true,title:'Facts',statusBarStyle:'black-translucent'}
};

export const viewport:Viewport={
 width:'device-width',
 initialScale:1,
 viewportFit:'cover',
 themeColor:'#111111'
};

export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="pt-BR" suppressHydrationWarning><body><ThemeProvider><TooltipProvider>{children}</TooltipProvider></ThemeProvider></body></html>;
}
