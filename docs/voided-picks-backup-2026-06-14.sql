-- FoodBall — reversible backup of the 27 post-kickoff picks + their score_events
-- Captured 2026-06-14 before the void (scripts/void-post-kickoff-picks.sql).
-- To restore: set session_replication_role=replica; run these INSERTs; reset.
-- NOTE: includes Chef tawfiq's 4 admin picks (69,71,79,227) which were NOT voided.

-- match_picks --
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (69,'85379e7d-f257-47a9-8f3f-5e3be8599a49',6,'outcome','draw','2026-06-11 21:04:27.101971+00',0);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (71,'85379e7d-f257-47a9-8f3f-5e3be8599a49',6,'btts','yes','2026-06-11 21:04:39.9584+00',0);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (79,'85379e7d-f257-47a9-8f3f-5e3be8599a49',6,'over_under','over','2026-06-11 21:05:40.538989+00',0);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (87,'8438f400-c9c6-4cd5-8f3d-8ffa91bc24e8',6,'btts','no','2026-06-11 21:08:00.456977+00',5);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (88,'8438f400-c9c6-4cd5-8f3d-8ffa91bc24e8',6,'over_under','under','2026-06-11 21:08:28.437237+00',5);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (92,'8438f400-c9c6-4cd5-8f3d-8ffa91bc24e8',6,'exact_score','2-0','2026-06-11 21:08:53.984043+00',25);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (118,'b0b133bc-a8ab-4851-a92f-7ad9050422be',6,'btts','no','2026-06-11 21:13:28.176072+00',5);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (127,'b0b133bc-a8ab-4851-a92f-7ad9050422be',6,'over_under','under','2026-06-11 21:14:12.956927+00',5);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (129,'c088bfdf-ea69-4042-a6d3-dbf31f662bd1',6,'outcome','home','2026-06-11 21:14:42.831688+00',10);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (184,'8cfb19cc-cbe1-4ef9-a31c-fbd0073b89d8',6,'outcome','home','2026-06-11 21:21:02.754719+00',10);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (224,'8cfb19cc-cbe1-4ef9-a31c-fbd0073b89d8',6,'btts','no','2026-06-11 21:24:59.689308+00',5);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (225,'8cfb19cc-cbe1-4ef9-a31c-fbd0073b89d8',6,'over_under','under','2026-06-11 21:25:04.75793+00',5);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (227,'85379e7d-f257-47a9-8f3f-5e3be8599a49',6,'exact_score','0-0','2026-06-11 21:26:39.699555+00',0);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (232,'8438f400-c9c6-4cd5-8f3d-8ffa91bc24e8',6,'outcome','home','2026-06-11 21:28:39.433744+00',10);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (237,'906e5264-3559-4807-8abf-d0158e3363a4',6,'exact_score','2-0','2026-06-12 00:29:06.246534+00',25);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (238,'906e5264-3559-4807-8abf-d0158e3363a4',6,'btts','yes','2026-06-12 00:29:14.553539+00',0);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (376,'b0b133bc-a8ab-4851-a92f-7ad9050422be',12,'outcome','away','2026-06-12 19:07:25.984799+00',0);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (377,'b0b133bc-a8ab-4851-a92f-7ad9050422be',12,'exact_score','0-3','2026-06-12 19:07:36.764604+00',0);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (770,'c088bfdf-ea69-4042-a6d3-dbf31f662bd1',19,'outcome','away','2026-06-14 01:14:34.923481+00',10);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (785,'82d2f2ac-b72a-413f-bcbe-c8bf7d04889b',25,'outcome','away','2026-06-14 04:57:20.429567+00',NULL);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (788,'21dc136f-e1a2-4274-a8df-04b60eef6ddc',25,'outcome','home','2026-06-14 04:58:21.387166+00',NULL);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (790,'82d2f2ac-b72a-413f-bcbe-c8bf7d04889b',25,'exact_score','0-2','2026-06-14 04:58:31.915164+00',NULL);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (797,'8cfb19cc-cbe1-4ef9-a31c-fbd0073b89d8',25,'outcome','home','2026-06-14 05:10:29.488097+00',NULL);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (798,'8cfb19cc-cbe1-4ef9-a31c-fbd0073b89d8',25,'exact_score','1-0','2026-06-14 05:11:15.965319+00',NULL);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (805,'1412430a-f12f-4b27-b496-a9741f348a90',25,'outcome','home','2026-06-14 05:24:48.563557+00',NULL);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (808,'21dc136f-e1a2-4274-a8df-04b60eef6ddc',25,'exact_score','2-0','2026-06-14 05:40:42.124799+00',NULL);
INSERT INTO public.match_picks (id,user_id,match_id,market,selection,created_at,points_awarded) VALUES (809,'21dc136f-e1a2-4274-a8df-04b60eef6ddc',25,'over_under','under','2026-06-14 05:54:30.382603+00',NULL);

-- score_events --
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (36,'8cfb19cc-cbe1-4ef9-a31c-fbd0073b89d8','match_picks',225,5,'over_under:under','2026-06-12 08:00:00.052022+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (37,'8cfb19cc-cbe1-4ef9-a31c-fbd0073b89d8','match_picks',184,10,'outcome:home','2026-06-12 08:00:00.052022+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (38,'b0b133bc-a8ab-4851-a92f-7ad9050422be','match_picks',118,5,'btts:no','2026-06-12 08:00:00.052022+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (39,'b0b133bc-a8ab-4851-a92f-7ad9050422be','match_picks',127,5,'over_under:under','2026-06-12 08:00:00.052022+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (40,'c088bfdf-ea69-4042-a6d3-dbf31f662bd1','match_picks',129,10,'outcome:home','2026-06-12 08:00:00.052022+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (41,'85379e7d-f257-47a9-8f3f-5e3be8599a49','match_picks',71,0,'btts:yes','2026-06-12 08:00:00.052022+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (42,'85379e7d-f257-47a9-8f3f-5e3be8599a49','match_picks',79,0,'over_under:over','2026-06-12 08:00:00.052022+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (43,'8438f400-c9c6-4cd5-8f3d-8ffa91bc24e8','match_picks',87,5,'btts:no','2026-06-12 08:00:00.052022+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (44,'8438f400-c9c6-4cd5-8f3d-8ffa91bc24e8','match_picks',92,25,'exact:2-0','2026-06-12 08:00:00.052022+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (45,'8cfb19cc-cbe1-4ef9-a31c-fbd0073b89d8','match_picks',224,5,'btts:no','2026-06-12 08:00:00.052022+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (46,'8438f400-c9c6-4cd5-8f3d-8ffa91bc24e8','match_picks',88,5,'over_under:under','2026-06-12 08:00:00.052022+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (47,'85379e7d-f257-47a9-8f3f-5e3be8599a49','match_picks',69,0,'outcome:home','2026-06-12 08:00:00.052022+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (48,'85379e7d-f257-47a9-8f3f-5e3be8599a49','match_picks',227,0,'exact:0-0','2026-06-12 08:00:00.052022+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (49,'8438f400-c9c6-4cd5-8f3d-8ffa91bc24e8','match_picks',232,10,'outcome:home','2026-06-12 08:00:00.052022+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (50,'906e5264-3559-4807-8abf-d0158e3363a4','match_picks',237,25,'exact:2-0','2026-06-12 08:00:00.052022+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (51,'906e5264-3559-4807-8abf-d0158e3363a4','match_picks',238,0,'btts:yes','2026-06-12 08:00:00.052022+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (66,'b0b133bc-a8ab-4851-a92f-7ad9050422be','match_picks',376,0,'outcome:draw','2026-06-12 22:00:00.115861+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (71,'b0b133bc-a8ab-4851-a92f-7ad9050422be','match_picks',377,0,'exact:0-3','2026-06-12 22:00:00.115861+00');
INSERT INTO public.score_events (id,user_id,source_table,source_id,points,reason,created_at) VALUES (176,'c088bfdf-ea69-4042-a6d3-dbf31f662bd1','match_picks',770,10,'outcome:away','2026-06-14 04:00:00.130018+00');
