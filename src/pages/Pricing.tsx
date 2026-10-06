import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router";

const plans = [
  { name:"Free", price:"$0", description:"Explore the core market-analysis workflow.", features:["Market analysis","Live evidence when available","Limited actionable opportunities"] },
  { name:"Pro", price:"Coming soon", description:"Higher limits and the complete research workflow.", features:["Higher analysis allowance","Full opportunity ranking","Journal-based performance history","Advanced market intelligence"] },
];

export default function Pricing() {
  const navigate=useNavigate();
  return <div className="min-h-screen bg-background panel-grid">
    <header className="border-b border-border/60"><div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
      <button onClick={()=>navigate("/")} className="chrome-text text-lg font-semibold tracking-[0.18em]">XSTARZG</button>
      <Button variant="ghost" onClick={()=>navigate("/")}><ChevronLeft className="mr-1 size-4"/>Back</Button>
    </div></header>
    <main className="mx-auto max-w-5xl px-5 py-16">
      <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Pricing</p>
      <h1 className="mt-3 text-4xl font-semibold">Simple access.</h1>
      <p className="mt-4 max-w-xl text-muted-foreground">The product stays usable on the free tier. Paid billing is shown honestly and will activate only when a real checkout connection exists.</p>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {plans.map(p=><Card key={p.name} className="metal-panel"><CardHeader><CardTitle className="flex items-end justify-between"><span>{p.name}</span><span className="text-xl">{p.price}</span></CardTitle><p className="text-sm text-muted-foreground">{p.description}</p></CardHeader><CardContent><ul className="space-y-3">{p.features.map(f=><li key={f} className="flex gap-2 text-sm"><Check className="mt-0.5 size-4 text-primary"/>{f}</li>)}</ul><Button className="mt-7 w-full" variant={p.name==="Free"?"default":"outline"} onClick={()=>navigate("/auth")}>{p.name==="Free"?"Start free":"Join Pro waitlist"}</Button></CardContent></Card>)}
      </div>
    </main>
  </div>;
}