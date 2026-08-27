"use client"

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

const CHART_COLORS = ["#7c3aed", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe"]

type TrendPoint = { date: string; reservations: number; covers: number; label: string }
type ChannelPoint = { name: string; value: number; covers: number }
type HourPoint = { hour: string; reservations: number }

type ReportsChartsProps = {
  trendData: TrendPoint[]
  channelData: ChannelPoint[]
  hours: HourPoint[]
  change: number
  reservationLabel: string
  trendTitle: string
  trendDescription: string
  channelsTitle: string
  channelsDescription: string
  hoursTitle: string
  hoursDescription: string
  locale: string
  number: (value: number, locale: string) => string
}

export function ReportsCharts({
  trendData,
  channelData,
  hours,
  change,
  reservationLabel,
  trendTitle,
  trendDescription,
  channelsTitle,
  channelsDescription,
  hoursTitle,
  hoursDescription,
  locale,
  number,
}: ReportsChartsProps) {
  const changePositive = change >= 0

  return <>
    <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.8fr)]">
      <Card className="border-0 bg-white shadow-sm ring-1 ring-slate-200/70 dark:bg-white/[0.04] dark:ring-white/10"><CardContent className="p-5"><div className="flex items-start justify-between"><div><h2 className="text-base font-bold text-slate-950 dark:text-white">{trendTitle}</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{trendDescription}</p></div><span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${changePositive ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"}`}>{changePositive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}{Math.abs(change)}%</span></div><div className="mt-6 h-[280px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trendData} margin={{ left: -20, right: 8, top: 5, bottom: 0 }}><defs><linearGradient id="reportTrend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7c3aed" stopOpacity={0.32} /><stop offset="100%" stopColor="#7c3aed" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#e9e7f1" strokeDasharray="3 3" /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} /><YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} /><Tooltip contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0", boxShadow: "0 12px 28px rgba(15,23,42,.12)" }} /><Area type="monotone" dataKey="reservations" name={reservationLabel} stroke="#7c3aed" strokeWidth={3} fill="url(#reportTrend)" /></AreaChart></ResponsiveContainer></div></CardContent></Card>
      <Card className="border-0 bg-white shadow-sm ring-1 ring-slate-200/70 dark:bg-white/[0.04] dark:ring-white/10"><CardContent className="p-5"><h2 className="text-base font-bold text-slate-950 dark:text-white">{channelsTitle}</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{channelsDescription}</p><div className="mt-3 h-[170px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={channelData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={70} paddingAngle={4}>{channelData.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie><Tooltip contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} /></PieChart></ResponsiveContainer></div><div className="space-y-2">{channelData.map((item, index) => <div key={item.name} className="flex items-center justify-between text-xs"><span className="flex items-center gap-2 font-medium text-slate-600 dark:text-slate-300"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />{item.name}</span><span className="font-bold text-slate-900 dark:text-white">{number(item.value, locale)}</span></div>)}</div></CardContent></Card>
    </section>

    <section className="mt-5"><Card className="border-0 bg-white shadow-sm ring-1 ring-slate-200/70 dark:bg-white/[0.04] dark:ring-white/10"><CardContent className="p-5"><div><h2 className="text-base font-bold text-slate-950 dark:text-white">{hoursTitle}</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hoursDescription}</p></div><div className="mt-5 h-[220px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={hours} margin={{ left: -20, right: 8 }}><CartesianGrid vertical={false} stroke="#e9e7f1" strokeDasharray="3 3" /><XAxis dataKey="hour" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} /><Tooltip cursor={{ fill: "#f5f3ff" }} contentStyle={{ borderRadius: 14, border: "1px solid #e2e8f0" }} /><Bar dataKey="reservations" name={reservationLabel} fill="#8b5cf6" radius={[7, 7, 0, 0]} /></BarChart></ResponsiveContainer></div></CardContent></Card></section>
  </>
}
