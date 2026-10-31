import {comparableEvidence,medianValue,type AgentEvidence} from "./workspace";
export function evaluateEvidence(current:AgentEvidence,history:AgentEvidence[]){
  const previous=comparableEvidence(history,current).filter(h=>h.video_id!==current.video_id);const baseline=medianValue(previous.map(h=>h.views));
  const observations=["Views video pada "+current.start+" sampai "+current.end+": "+(current.views===null?"belum tersedia":current.views.toLocaleString("id-ID"))+"."];
  if(baseline!==null)observations.push("Median views "+previous.length+" video pembanding pada periode kalender yang sama: "+baseline.toLocaleString("id-ID")+".");
  if(current.average_view_percentage!==null)observations.push("Rata-rata persentase ditonton: "+current.average_view_percentage.toLocaleString("id-ID")+"%.");
  if(current.viewed_vs_swiped!==null)observations.push("Keep watching dari sumber tersedia: "+current.viewed_vs_swiped+"%.");
  const limitations=["Periode kalender sama belum menjamin umur publikasi dan sumber trafik setara. Perbedaan ini tidak membuktikan penyebab.","Data publik kompetitor tidak menyediakan retensi privat. Perubahan algoritma tidak dapat disimpulkan dari views saja."];
  if(baseline===null)limitations.push("Belum ada data pembanding pada periode yang sama.");
  if(current.viewed_vs_swiped===null)limitations.push("Keep watching belum tersedia; tidak dihitung dari views atau engaged views.");
  if(current.average_view_percentage===null)limitations.push("Rata-rata persentase ditonton belum tersedia.");
  return {observations,hypotheses:[] as string[],recommendations:["Uji satu perubahan pada episode berikutnya dan bandingkan pada umur publikasi yang sama.","Gunakan kurva retensi dan naskah untuk menentukan bagian yang perlu diuji; pertahankan bagian lain."],evidence:[current,...previous],limitations};
}
