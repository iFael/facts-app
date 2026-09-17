function required(name:string,value:string|undefined){
 if(!value)throw new Error(`Configuração pública do Supabase ausente: ${name}.`);
 return value;
}

export const supabaseUrl=required('NEXT_PUBLIC_SUPABASE_URL',process.env.NEXT_PUBLIC_SUPABASE_URL);
export const publishableKey=required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
