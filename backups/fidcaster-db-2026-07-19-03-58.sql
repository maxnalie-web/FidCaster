--
-- PostgreSQL database dump
--

\restrict JXqe56Fhc58b7qwKRmV3Auntb5hOvafoiV62BnljMVxrlJy1DX5pkG0d8HyafSF

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: grow_targets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.grow_targets (
    id bigint NOT NULL,
    fid bigint NOT NULL,
    target_fid bigint NOT NULL,
    used_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.grow_targets OWNER TO postgres;

--
-- Name: grow_targets_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.grow_targets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.grow_targets_id_seq OWNER TO postgres;

--
-- Name: grow_targets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.grow_targets_id_seq OWNED BY public.grow_targets.id;


--
-- Name: push_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.push_tokens (
    fid integer NOT NULL,
    token text NOT NULL,
    platform text DEFAULT 'android'::text NOT NULL,
    updated_at bigint NOT NULL
);


ALTER TABLE public.push_tokens OWNER TO postgres;

--
-- Name: referrals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.referrals (
    id bigint NOT NULL,
    referrer_fid bigint NOT NULL,
    referred_fid bigint NOT NULL,
    code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    activated boolean DEFAULT false NOT NULL,
    activated_at timestamp with time zone
);


ALTER TABLE public.referrals OWNER TO postgres;

--
-- Name: referrals_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.referrals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.referrals_id_seq OWNER TO postgres;

--
-- Name: referrals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.referrals_id_seq OWNED BY public.referrals.id;


--
-- Name: user_actions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_actions (
    id bigint NOT NULL,
    fid bigint NOT NULL,
    action_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    proof text,
    verified boolean DEFAULT false NOT NULL,
    verified_at timestamp with time zone,
    excluded boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    excluded_reason text
);


ALTER TABLE public.user_actions OWNER TO postgres;

--
-- Name: user_actions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_actions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_actions_id_seq OWNER TO postgres;

--
-- Name: user_actions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_actions_id_seq OWNED BY public.user_actions.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    fid bigint NOT NULL,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    eligible boolean,
    eligible_checked_at timestamp with time zone
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: wallet_addresses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.wallet_addresses (
    fid bigint NOT NULL,
    address text NOT NULL,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.wallet_addresses OWNER TO postgres;

--
-- Name: watcher_canary; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.watcher_canary (
    key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.watcher_canary OWNER TO postgres;

--
-- Name: grow_targets id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grow_targets ALTER COLUMN id SET DEFAULT nextval('public.grow_targets_id_seq'::regclass);


--
-- Name: referrals id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referrals ALTER COLUMN id SET DEFAULT nextval('public.referrals_id_seq'::regclass);


--
-- Name: user_actions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_actions ALTER COLUMN id SET DEFAULT nextval('public.user_actions_id_seq'::regclass);


--
-- Data for Name: grow_targets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.grow_targets (id, fid, target_fid, used_at) FROM stdin;
\.


--
-- Data for Name: push_tokens; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.push_tokens (fid, token, platform, updated_at) FROM stdin;
\.


--
-- Data for Name: referrals; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.referrals (id, referrer_fid, referred_fid, code, created_at, activated, activated_at) FROM stdin;
\.


--
-- Data for Name: user_actions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_actions (id, fid, action_type, payload, proof, verified, verified_at, excluded, created_at, excluded_reason) FROM stdin;
1	266488	market_cancel	{"buyer": null, "seller": "0xc552e4d1f9d096dfbe7212a6bd22c29b23541dc3", "priceWei": "0", "blockNumber": 153537225}	0x26442bb71e4491c528b9db82f72e4ee60362ab2125b46c610c580b80e3d2c9c2	t	2026-07-19 01:03:55.399483+00	f	2026-07-19 01:03:55.399483+00	\N
4	255108	market_list	{"buyer": null, "seller": "0x083aafa7cddf08f55b678baa506b937b2fd29eef", "priceWei": "294054128440366935", "blockNumber": 153544133}	0xc30454a5c0bd987e327a6bbd4a1de5e6d4dc6c39ea7a8f8d50563a28d1b54b36	t	2026-07-19 01:03:55.401703+00	f	2026-07-19 01:03:55.401703+00	\N
3	255108	market_cancel	{"buyer": null, "seller": "0x083aafa7cddf08f55b678baa506b937b2fd29eef", "priceWei": "0", "blockNumber": 153537347}	0x2fef89821a38aae899aa11b7a526f9b90860e963d6a876dba977f731d3fd66cd	t	2026-07-19 01:03:55.397728+00	f	2026-07-19 01:03:55.397728+00	\N
5	307588	market_list	{"buyer": null, "seller": "0x34682c2fc31336b3feabdef0fa22d3a0bcb1ee6b", "priceWei": "126878899082568802", "blockNumber": 0}	listing-307588	t	2026-07-19 01:03:55.397883+00	f	2026-07-19 01:03:55.397883+00	\N
7	311059	market_list	{"buyer": null, "seller": "0x6e98766d59aa3aa18ce7ddf40a3ba3035e4d9feb", "priceWei": "102011926605504580", "blockNumber": 153579626}	0x086055e04161f4595e229b861b2ece02e72a6ff54d9d53b6eb1e4682c28e6e07	t	2026-07-19 01:03:55.431852+00	f	2026-07-19 01:03:55.431852+00	\N
8	358829	market_list	{"buyer": null, "seller": "0x3bbddf621f88e210f42766a707c620ead21e2f6e", "priceWei": "72603669724770642", "blockNumber": 153486666}	0x46835b55a525284541de565074af133b139725aeca41426c8ef99d1aa4eea17c	t	2026-07-19 01:03:55.431843+00	f	2026-07-19 01:03:55.431843+00	\N
11	505368	market_list	{"buyer": null, "seller": "0x27425e88b6d9c3f6a9605ea7855df407410ecb4e", "priceWei": "128657798165137616", "blockNumber": 0}	listing-505368	t	2026-07-19 01:03:55.432738+00	f	2026-07-19 01:03:55.432738+00	\N
14	1027109	market_list	{"buyer": null, "seller": "0x882a06ac0a213de1eeb01d6c6b93f2520ad3244e", "priceWei": "244190825688073404", "blockNumber": 0}	listing-1027109	t	2026-07-19 01:03:55.431687+00	f	2026-07-19 01:03:55.431687+00	\N
2	309998	market_list	{"buyer": null, "seller": "0xbdecc2097288ca113cad6d43c79aabd192bdc6cb", "priceWei": "2923803669724770238", "blockNumber": 153534161}	0x64f3bf8d5427d29e96b4271833d02fa69df1cc91be55a9d60ddd051e545ac86e	t	2026-07-19 01:03:55.40174+00	f	2026-07-19 01:03:55.40174+00	\N
12	358829	market_cancel	{"buyer": null, "seller": "0x3bbddf621f88e210f42766a707c620ead21e2f6e", "priceWei": "0", "blockNumber": 153478531}	0xe7417c5393bfd3a4842aaedb316fdec8ea5d8851bef38d1f7797e24790169620	t	2026-07-19 01:03:55.43287+00	f	2026-07-19 01:03:55.43287+00	\N
6	303110	market_cancel	{"buyer": null, "seller": "0xf7e2979cae42f6afdb14a74490c0aad0ee787f61", "priceWei": "0", "blockNumber": 153551940}	0xd2bbbc936f692b734d331152b6ac280a039c24ccd24c03edd22cf119e78ea7ac	t	2026-07-19 01:03:55.418343+00	f	2026-07-19 01:03:55.418343+00	\N
9	303110	market_list	{"buyer": null, "seller": "0xf7e2979cae42f6afdb14a74490c0aad0ee787f61", "priceWei": "145086238532110084", "blockNumber": 153551955}	0x739dd5dcbabc011997dbbf28e14f3d2749abb48f67caa550385afc539cb24056	t	2026-07-19 01:03:55.432027+00	f	2026-07-19 01:03:55.432027+00	\N
10	598723	market_cancel	{"buyer": null, "seller": "0xdc36981d7466fb70d710c80b74c66a375c54b907", "priceWei": "0", "blockNumber": 153551544}	0x5505efc803c69548b4ae70c5b376bf7cdc2c5478f2587efcfef77219ab181e57	t	2026-07-19 01:03:55.432626+00	f	2026-07-19 01:03:55.432626+00	\N
13	358829	market_cancel	{"buyer": null, "seller": "0x3bbddf621f88e210f42766a707c620ead21e2f6e", "priceWei": "0", "blockNumber": 153486093}	0xafd17371dc542602d68dc8346f9ec4fd4ac38c8e63b38eb77e5ab320a8b429d1	t	2026-07-19 01:03:55.432957+00	f	2026-07-19 01:03:55.432957+00	\N
15	358829	market_list	{"buyer": null, "seller": "0x3bbddf621f88e210f42766a707c620ead21e2f6e", "priceWei": "57000000000000000", "blockNumber": 153484145}	0xa14eca1dfcbbddb93c9e51dd442da834d67c926a1fd9357bac17798b4b2594c3	t	2026-07-19 01:03:55.439695+00	f	2026-07-19 01:03:55.439695+00	\N
16	598723	market_list	{"buyer": null, "seller": "0xdc36981d7466fb70d710c80b74c66a375c54b907", "priceWei": "145986238532110069", "blockNumber": 153561626}	0xa0b843e3d55252a0b87b04bdd1ee9d9011691b9390a4bfa0c3037635df6dbf19	t	2026-07-19 01:03:55.440132+00	f	2026-07-19 01:03:55.440132+00	\N
1892	358829	market_list	{"buyer": null, "seller": "0x3bbddf621f88e210f42766a707c620ead21e2f6e", "priceWei": "72603669724770642", "blockNumber": 0}	listing-358829	t	2026-07-19 02:18:02.880091+00	f	2026-07-19 02:18:02.880091+00	\N
1899	311059	market_list	{"buyer": null, "seller": "0x6e98766d59aa3aa18ce7ddf40a3ba3035e4d9feb", "priceWei": "102011926605504580", "blockNumber": 0}	listing-311059	t	2026-07-19 02:18:02.881946+00	f	2026-07-19 02:18:02.881946+00	\N
1897	303110	market_list	{"buyer": null, "seller": "0xf7e2979cae42f6afdb14a74490c0aad0ee787f61", "priceWei": "145086238532110084", "blockNumber": 0}	listing-303110	t	2026-07-19 02:18:02.884462+00	f	2026-07-19 02:18:02.884462+00	\N
1895	598723	market_list	{"buyer": null, "seller": "0xdc36981d7466fb70d710c80b74c66a375c54b907", "priceWei": "145986238532110069", "blockNumber": 0}	listing-598723	t	2026-07-19 02:18:02.882041+00	f	2026-07-19 02:18:02.882041+00	\N
1894	255108	market_list	{"buyer": null, "seller": "0x083aafa7cddf08f55b678baa506b937b2fd29eef", "priceWei": "294054128440366935", "blockNumber": 0}	listing-255108	t	2026-07-19 02:18:02.882744+00	f	2026-07-19 02:18:02.882744+00	\N
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (fid, first_seen, last_seen, eligible, eligible_checked_at) FROM stdin;
1027109	2026-07-19 01:03:55.384882+00	2026-07-19 03:58:32.908877+00	\N	\N
255108	2026-07-19 01:03:55.354889+00	2026-07-19 03:58:32.912258+00	\N	\N
307588	2026-07-19 01:03:55.32637+00	2026-07-19 03:58:32.912938+00	\N	\N
505368	2026-07-19 01:03:55.379564+00	2026-07-19 03:58:32.914246+00	\N	\N
311059	2026-07-19 01:03:55.383673+00	2026-07-19 03:58:32.915163+00	\N	\N
598723	2026-07-19 01:03:55.402875+00	2026-07-19 03:58:32.916743+00	\N	\N
303110	2026-07-19 01:03:55.372071+00	2026-07-19 03:58:32.917009+00	\N	\N
358829	2026-07-19 01:03:55.375154+00	2026-07-19 03:58:32.91819+00	\N	\N
266488	2026-07-19 01:03:55.368266+00	2026-07-19 02:13:53.747336+00	\N	\N
309998	2026-07-19 01:03:55.368527+00	2026-07-19 02:13:53.748901+00	\N	\N
\.


--
-- Data for Name: wallet_addresses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.wallet_addresses (fid, address, registered_at, updated_at) FROM stdin;
\.


--
-- Data for Name: watcher_canary; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.watcher_canary (key, created_at) FROM stdin;
\.


--
-- Name: grow_targets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.grow_targets_id_seq', 1, false);


--
-- Name: referrals_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.referrals_id_seq', 1, false);


--
-- Name: user_actions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_actions_id_seq', 5155, true);


--
-- Name: grow_targets grow_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grow_targets
    ADD CONSTRAINT grow_targets_pkey PRIMARY KEY (id);


--
-- Name: push_tokens push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.push_tokens
    ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (fid, token);


--
-- Name: referrals referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);


--
-- Name: user_actions user_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_actions
    ADD CONSTRAINT user_actions_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (fid);


--
-- Name: wallet_addresses wallet_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.wallet_addresses
    ADD CONSTRAINT wallet_addresses_pkey PRIMARY KEY (fid);


--
-- Name: watcher_canary watcher_canary_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.watcher_canary
    ADD CONSTRAINT watcher_canary_pkey PRIMARY KEY (key);


--
-- Name: idx_gt_fid_target; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_gt_fid_target ON public.grow_targets USING btree (fid, target_fid);


--
-- Name: idx_gt_fid_used; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_gt_fid_used ON public.grow_targets USING btree (fid, used_at DESC);


--
-- Name: idx_ref_referrer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ref_referrer ON public.referrals USING btree (referrer_fid);


--
-- Name: idx_ua_fid_type_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ua_fid_type_created ON public.user_actions USING btree (fid, action_type, created_at DESC);


--
-- Name: idx_ua_verified_excl_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ua_verified_excl_created ON public.user_actions USING btree (created_at DESC) WHERE ((verified = true) AND (excluded = false));


--
-- Name: idx_users_eligible; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_eligible ON public.users USING btree (eligible) WHERE (eligible = false);


--
-- Name: push_tokens_fid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX push_tokens_fid ON public.push_tokens USING btree (fid);


--
-- Name: uniq_ref_referred; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_ref_referred ON public.referrals USING btree (referred_fid);


--
-- Name: uniq_ua_type_proof; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_ua_type_proof ON public.user_actions USING btree (action_type, proof) WHERE (proof IS NOT NULL);


--
-- Name: uniq_wa_address; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_wa_address ON public.wallet_addresses USING btree (lower(address));


--
-- PostgreSQL database dump complete
--

\unrestrict JXqe56Fhc58b7qwKRmV3Auntb5hOvafoiV62BnljMVxrlJy1DX5pkG0d8HyafSF

