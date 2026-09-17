import type {NextConfig} from 'next';

const securityHeaders=[
 {key:'X-Content-Type-Options',value:'nosniff'},
 {key:'Referrer-Policy',value:'no-referrer'},
 {key:'X-Frame-Options',value:'DENY'},
 {key:'Permissions-Policy',value:'geolocation=(), microphone=()'}
];

const nextConfig:NextConfig={
 async headers(){
  return [
   {source:'/:path*',headers:securityHeaders},
   {source:'/sw.js',headers:[{key:'Cache-Control',value:'no-cache, no-store, must-revalidate'}]},
   {source:'/manifest.webmanifest',headers:[{key:'Cache-Control',value:'public, max-age=3600'}]}
  ];
 }
};

export default nextConfig;
