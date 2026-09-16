import ExchangeUI from "@/components/exchange";
export default async function EntryPage({params}:{params:Promise<{id:string}>}){return <ExchangeUI entryId={(await params).id}/>;}
