import express from 'express';

const router=express.Router();

function parseSources(){
  return String(process.env.VISUALS_PUBLIC_SOURCE_URLS||'').split(',').map(s=>s.trim()).filter(Boolean).map((url,i)=>({
    id:'configured-'+i,
    type:'public',
    status:'LIVE',
    title:'Configured public visual source',
    provider:'TrackMeNow public source adapter',
    url
  }));
}

function safeCategory(category){
  const c=String(category||'LIVE').toUpperCase();
  return ['LIVE','CAMERAS','WEBCAMS','IMAGES','VIDEOS','CLIPS','SOURCE HISTORY'].includes(c)?c:'LIVE';
}

router.get('/',(req,res)=>{
  const category=safeCategory(req.query.category);
  const sources=parseSources();
  res.set('Cache-Control','no-store');
  res.json({
    ok:true,
    storage:'none',
    policy:'TrackMeNow does not store or copy public visual media.',
    category,
    sources:sources.map(s=>({...s,category})),
    labels:['LIVE','RECORDED','ARCHIVED','USER SHARED','SOURCE OFFLINE']
  });
});

router.get('/health',(_,res)=>res.json({
  ok:true,
  service:'trackmenow-visuals',
  storage:'none',
  configuredSources:parseSources().length
}));

export default router;
