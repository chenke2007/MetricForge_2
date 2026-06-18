SELECT '20260131',
       decode(GROUPING(a.vc_yewdw), 1, '业务单位', a.vc_yewdw) vc_yewdw,
       decode(GROUPING(a.vc_pilkhdxbq), 1, '披露客户大小标签', a.vc_pilkhdxbq) vc_pilkhdxbq,
       decode(GROUPING(a.vc_pilhybq), 1, '披露客户行业', a.vc_pilhybq) vc_pilhybq,
       decode(GROUPING(a.vc_diqysmc), 1, '五大区域', a.vc_diqysmc) vc_diqysmc,
       decode(GROUPING(a.vc_kehfl), 1, '客户性质', a.vc_kehfl) vc_kehfl,
       --decode(GROUPING(a.vc_waibpj), 1, '客户外部评级', a.vc_waibpj) vc_waibpj,
       decode(GROUPING(a.vc_guoyqfb), 1, '央国企业务分布', a.vc_guoyqfb) vc_guoyqfb,
       decode(GROUPING(a.vc_guoyqzjtx), 1, '央国企专精特新文字', a.vc_guoyqzjtx) vc_guoyqzjtx,
       decode(GROUPING(a.vc_minyqyfb), 1, '民营企业业务分布', a.vc_minyqyfb) vc_minyqyfb,
       COUNT(DISTINCT a.vc_xinzkhbh) nu_xinzkhs,
       SUM(a.dec_xiaose) dec_xiaose_sum,
       SYSDATE,
       decode(GROUPING(a.vc_yewdwdl), 1, '业务单位大类', a.vc_yewdwdl) vc_yewdwdl
  FROM (SELECT a.vc_hetbh,
               a.vc_yejgsbm vc_yewdw,
               CASE
                   WHEN regexp_like(a.vc_yejgsbm, '分公司') THEN
                    '分公司'
                   WHEN regexp_like(a.vc_yejgsbm, '事业部|业务总部|资产交易部|其他') THEN
                    '业务总部'
                   ELSE
                    a.vc_yejgsbm
               END vc_yewdwdl,
               wd.vc_pilkhdxbq,
               wd.vc_pilhybq,
               wd.vc_shengf,
               dq.vc_diqysmc,
               wd.vc_kehxzbq,
               wd.vc_shangsbq,
               CASE
                   WHEN wd.vc_kehxzbq IN ('国有企业-央企', '国有企业-地方国企', '政府机关') THEN
                    '央国企'
                   WHEN wd.vc_shangsbq = '否' AND
                        wd.vc_kehxzbq IN
                        ('个体户', '私营企业(内资)', '私营企业（内资）', '私营企业(外资)', '私营企业（外资）',
                         '私营企业(中外合资)', '私营企业（中外合资）', '其他', '集体企业', '外商控股企业',
                         '港澳台商控股企业', '外资企业-港澳台商控股企业') THEN
                    '民营未上市'
                   WHEN wd.vc_shangsbq = '是' AND
                        wd.vc_kehxzbq IN
                        ('个体户', '私营企业(内资)', '私营企业（内资）', '私营企业(外资)', '私营企业（外资）',
                         '私营企业(中外合资)', '私营企业（中外合资）', '其他', '集体企业', '外商控股企业',
                         '港澳台商控股企业', '外资企业-港澳台商控股企业') THEN
                    '民营上市'
                   WHEN wd.vc_kehxzbq = '事业单位' THEN
                    '事业单位'
                   WHEN wd.vc_yewxtid IN ('yewxtmc03', 'yewxtmc04') OR
                        wd.vc_kehxzbq = '个人' THEN
                    '个人'
                   ELSE
                    '未识别'
               END vc_kehfl,
               CASE
                   WHEN wd.vc_kehxzbq IN ('国有企业-央企', '国有企业-地方国企', '政府机关') THEN
                    CASE
                        WHEN ggfw.vc_hetbh IS NOT NULL THEN
                         '公共服务支持'
                        WHEN zcpz.VC_HANGYMLMC = '建筑业' THEN
                         '建筑业'
                        WHEN zcpz.VC_HANGYFL IN
                             ('高端制造', '数字经济', '能源电力', '交通运输', '环保', '医疗健康产业') THEN
                         zcpz.VC_HANGYFL
                        ELSE
                         '其他'
                    END
                   ELSE
                    '不统计'
               END vc_guoyqfb,
               CASE
                   WHEN wd.vc_kehxzbq IN ('国有企业-央企', '国有企业-地方国企', '政府机关') AND
                        xcbq.VC_ZHUANJTX = 'Y' THEN
                    '央国企专精特新'
                   ELSE
                    '不统计'
               END vc_guoyqzjtx,
               CASE
                   WHEN wd.vc_kehxzbq IN
                        ('个体户', '私营企业(内资)', '私营企业（内资）', '私营企业(外资)', '私营企业（外资）',
                         '私营企业(中外合资)', '私营企业（中外合资）', '其他', '集体企业', '外商控股企业',
                         '港澳台商控股企业', '外资企业-港澳台商控股企业') THEN
                    CASE
                        WHEN xcbq.VC_ZHUANJTX = 'Y' THEN
                         '专精特新'
                        WHEN zcpz.VC_HANGYFL IN
                             ('高端制造', '数字经济', '能源电力', '交通运输', '环保', '医疗健康产业') THEN
                         zcpz.VC_HANGYFL
                        ELSE
                         '其他'
                    END
                   ELSE
                    '不统计'
               END vc_minyqyfb,
               --nvl(pj.vc_waibpj, '无评级') vc_waibpj,
               nvl(nvl(nvl(fc.cid, gc.cid), far.vc_kehbh), ger.vc_kehbh) vc_xinzkhbh,
               nvl(a.dec_xiaose, 0) dec_xiaose
          FROM dwhrpt.dws_fx_xiaose_sc a
          LEFT JOIN dwhrpt.dws_zc_hetqdxx_wd_d wd
            ON wd.pt = '20260131'
           AND wd.vc_hetbh = a.vc_hetbh
          LEFT JOIN dwhrpt.dws_cm_farkhxx_d far
            ON far.pt = wd.pt
           AND far.vc_yewxtid = wd.vc_yewxtid
           AND far.vc_kehbh = nvl(wd.vc_pinggztbh, wd.vc_chengzrbh)
          LEFT JOIN dwhrpt.dws_unicm_unicm_stock_cm_d fc
            ON fc.subid = far.vc_kehbh
           AND fc.sourcetype = '0' || substr(wd.vc_yewxtid, 8, 2)
          LEFT JOIN dwhrpt.dws_cm_gerkhxx_d ger
            ON ger.pt = wd.pt
           AND ger.vc_yewxtid = wd.vc_yewxtid
           AND ger.vc_kehbh = nvl(wd.vc_pinggztbh, wd.vc_chengzrbh)
          LEFT JOIN dwhrpt.dws_unicm_unicm_c_cm_d gc
            ON gc.subid = ger.vc_kehbh
           AND gc.sourcetype = '0' || substr(wd.vc_yewxtid, 8, 2)
          LEFT JOIN dwhrpt.dim_fx_diqysb dq
            ON dq.vc_shengfmc = wd.vc_shengf
        /*          LEFT JOIN dws_fx_cunlwbpj_sc pj
         ON pj.vc_hetbh = a.vc_hetbh
        AND pj.pt = wd.pt*/
          LEFT JOIN dwhrpt.dws_fx_gonggfwzclqytj_d ggfw
            ON ggfw.pt = '20260131'
           AND ggfw.vc_guank IS NULL
           AND ggfw.vc_hetlx = '存量'
           AND ggfw.vc_hetbh = a.vc_hetbh
          LEFT JOIN dwhrpt.dws_rpt_hanyzcgz_mx zcpz
            ON zcpz.vc_niany = substr('20260131', 1, 6)
           AND zcpz.vc_hetbh = a.vc_hetbh
          LEFT JOIN dwhrpt.dws_rpt_hetxcbq_m xcbq
            ON xcbq.pt = '20260131'
           AND xcbq.vc_hetbh = a.vc_hetbh
         WHERE a.pt = '20260131'
        --and a.vc_hetbh='L25A0338001'
        ) a
 GROUP BY GROUPING SETS(a.vc_yewdw, a.vc_yewdwdl,(a.vc_yewdw, a.vc_pilkhdxbq),(a.vc_yewdwdl, a.vc_pilkhdxbq), vc_pilkhdxbq,(a.vc_yewdw, a.vc_pilhybq),(a.vc_yewdwdl, a.vc_pilhybq), vc_pilhybq,(a.vc_yewdw, a.vc_diqysmc),(a.vc_yewdwdl, a.vc_diqysmc), vc_diqysmc,(a.vc_yewdw, a.vc_kehfl),(a.vc_yewdwdl, a.vc_kehfl), vc_kehfl, a.vc_yewdw, a.vc_yewdwdl, a.vc_guoyqfb, a.vc_guoyqzjtx, a.vc_minyqyfb, NULL);
