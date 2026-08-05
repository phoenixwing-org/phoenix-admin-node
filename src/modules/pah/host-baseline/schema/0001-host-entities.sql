CREATE TABLE "user_wx" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "unionid" character varying, "openid" character varying NOT NULL, "avatarUrl" character varying, "nickName" character varying, "gender" integer NOT NULL DEFAULT '0', "language" character varying, "city" character varying, "province" character varying, "country" character varying, "type" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_74ff980d0b777fdc051da729153" PRIMARY KEY ("id")); COMMENT ON COLUMN "user_wx"."id" IS 'ID'; COMMENT ON COLUMN "user_wx"."createTime" IS '创建时间'; COMMENT ON COLUMN "user_wx"."updateTime" IS '更新时间'; COMMENT ON COLUMN "user_wx"."tenantId" IS '租户ID'; COMMENT ON COLUMN "user_wx"."unionid" IS '微信unionid'; COMMENT ON COLUMN "user_wx"."openid" IS '微信openid'; COMMENT ON COLUMN "user_wx"."avatarUrl" IS '头像'; COMMENT ON COLUMN "user_wx"."nickName" IS '昵称'; COMMENT ON COLUMN "user_wx"."gender" IS '性别 0-未知 1-男 2-女'; COMMENT ON COLUMN "user_wx"."language" IS '语言'; COMMENT ON COLUMN "user_wx"."city" IS '城市'; COMMENT ON COLUMN "user_wx"."province" IS '省份'; COMMENT ON COLUMN "user_wx"."country" IS '国家'; COMMENT ON COLUMN "user_wx"."type" IS '类型 0-小程序 1-公众号 2-H5 3-APP';

CREATE INDEX "IDX_e23b473abf5a6b00e44f3fd842" ON "user_wx" ("createTime") ;

CREATE INDEX "IDX_049adb91204e94c1ede5e6dd23" ON "user_wx" ("updateTime") ;

CREATE INDEX "IDX_f39f7e2dd63c906fcee61c50ad" ON "user_wx" ("tenantId") ;

CREATE INDEX "IDX_d22b5fa040a01ec1b09e1e181e" ON "user_wx" ("unionid") ;

CREATE INDEX "IDX_7946849febadd93cf81fc2b53f" ON "user_wx" ("openid") ;

CREATE TABLE "user_info" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "unionid" character varying, "avatarUrl" character varying, "nickName" character varying, "phone" character varying, "gender" integer NOT NULL DEFAULT '0', "status" integer NOT NULL DEFAULT '1', "loginType" integer NOT NULL DEFAULT '0', "password" character varying, "description" text, CONSTRAINT "PK_273a06d6cdc2085ee1ce7638b24" PRIMARY KEY ("id")); COMMENT ON COLUMN "user_info"."id" IS 'ID'; COMMENT ON COLUMN "user_info"."createTime" IS '创建时间'; COMMENT ON COLUMN "user_info"."updateTime" IS '更新时间'; COMMENT ON COLUMN "user_info"."tenantId" IS '租户ID'; COMMENT ON COLUMN "user_info"."unionid" IS '登录唯一ID'; COMMENT ON COLUMN "user_info"."avatarUrl" IS '头像'; COMMENT ON COLUMN "user_info"."nickName" IS '昵称'; COMMENT ON COLUMN "user_info"."phone" IS '手机号'; COMMENT ON COLUMN "user_info"."gender" IS '性别'; COMMENT ON COLUMN "user_info"."status" IS '状态'; COMMENT ON COLUMN "user_info"."loginType" IS '登录方式'; COMMENT ON COLUMN "user_info"."password" IS '密码'; COMMENT ON COLUMN "user_info"."description" IS '介绍';

CREATE INDEX "IDX_e6386e92c288d85dbc43ac53f7" ON "user_info" ("createTime") ;

CREATE INDEX "IDX_5271afbb87138d688b6220b589" ON "user_info" ("updateTime") ;

CREATE INDEX "IDX_7c8ea8d68808b77734df54ce32" ON "user_info" ("tenantId") ;

CREATE UNIQUE INDEX "IDX_6edeceee578056a2c1e493563a" ON "user_info" ("unionid") ;

CREATE UNIQUE INDEX "IDX_9234e7bac72991a93b172618e2" ON "user_info" ("phone") ;

CREATE TABLE "user_address" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "userId" integer NOT NULL, "contact" character varying NOT NULL, "phone" character varying(11) NOT NULL, "province" character varying NOT NULL, "city" character varying NOT NULL, "district" character varying NOT NULL, "address" character varying NOT NULL, "isDefault" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_302d96673413455481d5ff4022a" PRIMARY KEY ("id")); COMMENT ON COLUMN "user_address"."id" IS 'ID'; COMMENT ON COLUMN "user_address"."createTime" IS '创建时间'; COMMENT ON COLUMN "user_address"."updateTime" IS '更新时间'; COMMENT ON COLUMN "user_address"."tenantId" IS '租户ID'; COMMENT ON COLUMN "user_address"."userId" IS '用户ID'; COMMENT ON COLUMN "user_address"."contact" IS '联系人'; COMMENT ON COLUMN "user_address"."phone" IS '手机号'; COMMENT ON COLUMN "user_address"."province" IS '省'; COMMENT ON COLUMN "user_address"."city" IS '市'; COMMENT ON COLUMN "user_address"."district" IS '区'; COMMENT ON COLUMN "user_address"."address" IS '地址'; COMMENT ON COLUMN "user_address"."isDefault" IS '是否默认';

CREATE INDEX "IDX_144621f4f7bf21e72ed6972d85" ON "user_address" ("createTime") ;

CREATE INDEX "IDX_de647797f6286697bfe9527955" ON "user_address" ("updateTime") ;

CREATE INDEX "IDX_d93103979d4be73c3192163996" ON "user_address" ("tenantId") ;

CREATE INDEX "IDX_1abd8badc4a127b0f357d9ecbc" ON "user_address" ("userId") ;

CREATE INDEX "IDX_905be3a22a4dfda68da8e4200a" ON "user_address" ("phone") ;

CREATE TABLE "task_log" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "taskId" integer, "status" integer NOT NULL DEFAULT '0', "detail" text, CONSTRAINT "PK_0f80f57bb78387f37ef146434b8" PRIMARY KEY ("id")); COMMENT ON COLUMN "task_log"."id" IS 'ID'; COMMENT ON COLUMN "task_log"."createTime" IS '创建时间'; COMMENT ON COLUMN "task_log"."updateTime" IS '更新时间'; COMMENT ON COLUMN "task_log"."tenantId" IS '租户ID'; COMMENT ON COLUMN "task_log"."taskId" IS '任务ID'; COMMENT ON COLUMN "task_log"."status" IS '状态 0-失败 1-成功'; COMMENT ON COLUMN "task_log"."detail" IS '详情描述';

CREATE INDEX "IDX_b9af0e100be034924b270aab31" ON "task_log" ("createTime") ;

CREATE INDEX "IDX_8857d8d43d38bebd7159af1fa6" ON "task_log" ("updateTime") ;

CREATE INDEX "IDX_fa4cb94036d961600c0f22ed91" ON "task_log" ("tenantId") ;

CREATE INDEX "IDX_1142dfec452e924b346f060fda" ON "task_log" ("taskId") ;

CREATE TABLE "task_info" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "jobId" character varying, "repeatConf" character varying(1000), "name" character varying NOT NULL, "cron" character varying, "limit" integer, "every" integer, "remark" character varying, "status" integer NOT NULL DEFAULT '1', "startDate" TIMESTAMP, "endDate" TIMESTAMP, "data" character varying, "service" character varying, "type" integer NOT NULL DEFAULT '0', "nextRunTime" TIMESTAMP, "taskType" integer NOT NULL DEFAULT '0', "lastExecuteTime" TIMESTAMP, "lockExpireTime" TIMESTAMP, CONSTRAINT "PK_deebbd0b60b8f276b9f1b0779e3" PRIMARY KEY ("id")); COMMENT ON COLUMN "task_info"."id" IS 'ID'; COMMENT ON COLUMN "task_info"."createTime" IS '创建时间'; COMMENT ON COLUMN "task_info"."updateTime" IS '更新时间'; COMMENT ON COLUMN "task_info"."tenantId" IS '租户ID'; COMMENT ON COLUMN "task_info"."jobId" IS '任务ID'; COMMENT ON COLUMN "task_info"."repeatConf" IS '任务配置'; COMMENT ON COLUMN "task_info"."name" IS '名称'; COMMENT ON COLUMN "task_info"."cron" IS 'cron'; COMMENT ON COLUMN "task_info"."limit" IS '最大执行次数 不传为无限次'; COMMENT ON COLUMN "task_info"."every" IS '每间隔多少毫秒执行一次 如果cron设置了 这项设置就无效'; COMMENT ON COLUMN "task_info"."remark" IS '备注'; COMMENT ON COLUMN "task_info"."status" IS '状态 0-停止 1-运行'; COMMENT ON COLUMN "task_info"."startDate" IS '开始时间'; COMMENT ON COLUMN "task_info"."endDate" IS '结束时间'; COMMENT ON COLUMN "task_info"."data" IS '数据'; COMMENT ON COLUMN "task_info"."service" IS '执行的service实例ID'; COMMENT ON COLUMN "task_info"."type" IS '状态 0-系统 1-用户'; COMMENT ON COLUMN "task_info"."nextRunTime" IS '下一次执行时间'; COMMENT ON COLUMN "task_info"."taskType" IS '状态 0-cron 1-时间间隔';

CREATE INDEX "IDX_6ced02f467e59bd6306b549bb0" ON "task_info" ("createTime") ;

CREATE INDEX "IDX_2adc6f9c241391126f27dac145" ON "task_info" ("updateTime") ;

CREATE INDEX "IDX_11b991dc4a7a5585c636008d3a" ON "task_info" ("tenantId") ;

CREATE TABLE "space_type" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "name" character varying NOT NULL, "parentId" integer, CONSTRAINT "PK_5ecc239af9d8ad8104c7f21a2cc" PRIMARY KEY ("id")); COMMENT ON COLUMN "space_type"."id" IS 'ID'; COMMENT ON COLUMN "space_type"."createTime" IS '创建时间'; COMMENT ON COLUMN "space_type"."updateTime" IS '更新时间'; COMMENT ON COLUMN "space_type"."tenantId" IS '租户ID'; COMMENT ON COLUMN "space_type"."name" IS '类别名称'; COMMENT ON COLUMN "space_type"."parentId" IS '父分类ID';

CREATE INDEX "IDX_6669449501d275f367ca295472" ON "space_type" ("createTime") ;

CREATE INDEX "IDX_0749b509b68488caecd4cc2bbc" ON "space_type" ("updateTime") ;

CREATE INDEX "IDX_5e7f846b8cdabbceba95ed3314" ON "space_type" ("tenantId") ;

CREATE TABLE "space_info" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "url" character varying NOT NULL, "type" character varying NOT NULL, "classifyId" integer, "fileId" character varying NOT NULL, "name" character varying NOT NULL, "size" integer NOT NULL, "version" integer NOT NULL DEFAULT '1', "key" character varying NOT NULL, CONSTRAINT "PK_e4a1552d98346f0260cd871beb7" PRIMARY KEY ("id")); COMMENT ON COLUMN "space_info"."id" IS 'ID'; COMMENT ON COLUMN "space_info"."createTime" IS '创建时间'; COMMENT ON COLUMN "space_info"."updateTime" IS '更新时间'; COMMENT ON COLUMN "space_info"."tenantId" IS '租户ID'; COMMENT ON COLUMN "space_info"."url" IS '地址'; COMMENT ON COLUMN "space_info"."type" IS '类型'; COMMENT ON COLUMN "space_info"."classifyId" IS '分类ID'; COMMENT ON COLUMN "space_info"."fileId" IS '文件id'; COMMENT ON COLUMN "space_info"."name" IS '文件名'; COMMENT ON COLUMN "space_info"."size" IS '文件大小'; COMMENT ON COLUMN "space_info"."version" IS '文档版本'; COMMENT ON COLUMN "space_info"."key" IS '文件位置';

CREATE INDEX "IDX_eb1da2f304c760846b5add09b3" ON "space_info" ("createTime") ;

CREATE INDEX "IDX_d7a2539961e9aacba8b353f3c9" ON "space_info" ("updateTime") ;

CREATE INDEX "IDX_6001c5ed2088b893c0d69bb244" ON "space_info" ("tenantId") ;

CREATE INDEX "IDX_0975633032bfe6574468b3a4ae" ON "space_info" ("fileId") ;

CREATE TABLE "recycle_data" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "entityInfo" json NOT NULL, "userId" integer, "data" json NOT NULL, "url" character varying, "params" json, "count" integer NOT NULL DEFAULT '1', CONSTRAINT "PK_a7477d0a3df5d76ed0405362bfb" PRIMARY KEY ("id")); COMMENT ON COLUMN "recycle_data"."id" IS 'ID'; COMMENT ON COLUMN "recycle_data"."createTime" IS '创建时间'; COMMENT ON COLUMN "recycle_data"."updateTime" IS '更新时间'; COMMENT ON COLUMN "recycle_data"."tenantId" IS '租户ID'; COMMENT ON COLUMN "recycle_data"."entityInfo" IS '表'; COMMENT ON COLUMN "recycle_data"."userId" IS '操作人'; COMMENT ON COLUMN "recycle_data"."data" IS '被删除的数据'; COMMENT ON COLUMN "recycle_data"."url" IS '请求的接口'; COMMENT ON COLUMN "recycle_data"."params" IS '请求参数'; COMMENT ON COLUMN "recycle_data"."count" IS '删除数据条数';

CREATE INDEX "IDX_59fc783673f4a322e9c83e0599" ON "recycle_data" ("createTime") ;

CREATE INDEX "IDX_c6a499c4a4fcd37f2930d27816" ON "recycle_data" ("updateTime") ;

CREATE INDEX "IDX_6659453338145e11d9b5103f38" ON "recycle_data" ("tenantId") ;

CREATE INDEX "IDX_f3ed09ba7090f3eb378cb83b5b" ON "recycle_data" ("userId") ;

CREATE TABLE "plugin_info" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "name" character varying NOT NULL, "description" character varying NOT NULL, "keyName" character varying NOT NULL, "hook" character varying NOT NULL, "readme" text NOT NULL, "version" character varying NOT NULL, "logo" text, "author" character varying NOT NULL, "status" integer NOT NULL DEFAULT '0', "content" json NOT NULL, "tsContent" json NOT NULL, "pluginJson" json, "config" json, CONSTRAINT "PK_96b52c53274f167372e50d7ec07" PRIMARY KEY ("id")); COMMENT ON COLUMN "plugin_info"."id" IS 'ID'; COMMENT ON COLUMN "plugin_info"."createTime" IS '创建时间'; COMMENT ON COLUMN "plugin_info"."updateTime" IS '更新时间'; COMMENT ON COLUMN "plugin_info"."tenantId" IS '租户ID'; COMMENT ON COLUMN "plugin_info"."name" IS '名称'; COMMENT ON COLUMN "plugin_info"."description" IS '简介'; COMMENT ON COLUMN "plugin_info"."keyName" IS 'Key名'; COMMENT ON COLUMN "plugin_info"."hook" IS 'Hook'; COMMENT ON COLUMN "plugin_info"."readme" IS '描述'; COMMENT ON COLUMN "plugin_info"."version" IS '版本'; COMMENT ON COLUMN "plugin_info"."logo" IS 'Logo(base64)'; COMMENT ON COLUMN "plugin_info"."author" IS '作者'; COMMENT ON COLUMN "plugin_info"."status" IS '状态 0-禁用 1-启用'; COMMENT ON COLUMN "plugin_info"."content" IS '内容'; COMMENT ON COLUMN "plugin_info"."tsContent" IS 'ts内容'; COMMENT ON COLUMN "plugin_info"."pluginJson" IS '插件的plugin.json'; COMMENT ON COLUMN "plugin_info"."config" IS '配置';

CREATE INDEX "IDX_071da0804576df95363c24357c" ON "plugin_info" ("createTime") ;

CREATE INDEX "IDX_d94d7c2437aca9f1b183979b07" ON "plugin_info" ("updateTime") ;

CREATE INDEX "IDX_89a39daf328b50686755795546" ON "plugin_info" ("tenantId") ;

CREATE INDEX "IDX_95719662507de0fbf70ad1b5ee" ON "plugin_info" ("keyName") ;

CREATE TABLE "pah_plugin_role_grant" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "moduleId" character varying NOT NULL, "roleId" integer NOT NULL, "contributionKey" character varying NOT NULL, CONSTRAINT "PK_800f27ffdf1d36e1f3a7bf4fd29" PRIMARY KEY ("id")); COMMENT ON COLUMN "pah_plugin_role_grant"."id" IS 'ID'; COMMENT ON COLUMN "pah_plugin_role_grant"."createTime" IS '创建时间'; COMMENT ON COLUMN "pah_plugin_role_grant"."updateTime" IS '更新时间'; COMMENT ON COLUMN "pah_plugin_role_grant"."tenantId" IS '租户ID'; COMMENT ON COLUMN "pah_plugin_role_grant"."moduleId" IS '稳定插件模块 ID'; COMMENT ON COLUMN "pah_plugin_role_grant"."roleId" IS '系统角色 ID'; COMMENT ON COLUMN "pah_plugin_role_grant"."contributionKey" IS '清单内稳定贡献键';

CREATE INDEX "IDX_613c1d92eed99384dbc6e11cd3" ON "pah_plugin_role_grant" ("createTime") ;

CREATE INDEX "IDX_17bbefa0beb1f426b55f329f1b" ON "pah_plugin_role_grant" ("updateTime") ;

CREATE INDEX "IDX_a9e56d3b3392ff9a98fe2b3a04" ON "pah_plugin_role_grant" ("tenantId") ;

CREATE INDEX "IDX_95508a42cf6930612ee85a26a8" ON "pah_plugin_role_grant" ("moduleId") ;

CREATE INDEX "IDX_e796698dbfb1ed91348ee26e00" ON "pah_plugin_role_grant" ("roleId") ;

CREATE UNIQUE INDEX "IDX_e0d015a264004b2bdce4b28844" ON "pah_plugin_role_grant" ("moduleId", "roleId", "contributionKey") ;

CREATE TABLE "pah_plugin_installation" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "moduleId" character varying NOT NULL, "name" character varying NOT NULL, "version" character varying NOT NULL, "publisher" character varying NOT NULL, "state" character varying NOT NULL, "activationMode" character varying NOT NULL DEFAULT 'restart', "manifest" json NOT NULL, "dataRetained" boolean NOT NULL DEFAULT true, "lastBackupId" character varying, "stateChangedAt" character varying, "lastError" text, CONSTRAINT "UQ_7772f216cbb61665ea15f71afa4" UNIQUE ("moduleId"), CONSTRAINT "PK_f4f67f7bc5288213c720a7252a2" PRIMARY KEY ("id")); COMMENT ON COLUMN "pah_plugin_installation"."id" IS 'ID'; COMMENT ON COLUMN "pah_plugin_installation"."createTime" IS '创建时间'; COMMENT ON COLUMN "pah_plugin_installation"."updateTime" IS '更新时间'; COMMENT ON COLUMN "pah_plugin_installation"."tenantId" IS '租户ID'; COMMENT ON COLUMN "pah_plugin_installation"."moduleId" IS '稳定模块 ID'; COMMENT ON COLUMN "pah_plugin_installation"."name" IS '插件名称'; COMMENT ON COLUMN "pah_plugin_installation"."version" IS '插件版本'; COMMENT ON COLUMN "pah_plugin_installation"."publisher" IS '发布者'; COMMENT ON COLUMN "pah_plugin_installation"."state" IS '生命周期状态'; COMMENT ON COLUMN "pah_plugin_installation"."activationMode" IS '激活方式'; COMMENT ON COLUMN "pah_plugin_installation"."manifest" IS '完整 manifest'; COMMENT ON COLUMN "pah_plugin_installation"."dataRetained" IS '卸载后是否保留数据'; COMMENT ON COLUMN "pah_plugin_installation"."lastBackupId" IS '最近备份标识'; COMMENT ON COLUMN "pah_plugin_installation"."stateChangedAt" IS '状态变更时间'; COMMENT ON COLUMN "pah_plugin_installation"."lastError" IS '最近错误';

CREATE INDEX "IDX_1fb4ada42f508fd8d7eb996e58" ON "pah_plugin_installation" ("createTime") ;

CREATE INDEX "IDX_b2a468c138b606d6fdbe7fdd27" ON "pah_plugin_installation" ("updateTime") ;

CREATE INDEX "IDX_b4cb36faf713ff18aeba5fecac" ON "pah_plugin_installation" ("tenantId") ;

CREATE UNIQUE INDEX "IDX_7772f216cbb61665ea15f71afa" ON "pah_plugin_installation" ("moduleId") ;

CREATE INDEX "IDX_9728b9f86f9fe4f13858146c33" ON "pah_plugin_installation" ("state") ;

CREATE TABLE "pah_navigation_group" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "groupKey" character varying NOT NULL, "label" character varying NOT NULL, "orderNum" integer NOT NULL DEFAULT '0', "isBuiltin" boolean NOT NULL DEFAULT false, "isEnabled" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_36c5695e1f4fa12a03640479ea5" PRIMARY KEY ("id")); COMMENT ON COLUMN "pah_navigation_group"."id" IS 'ID'; COMMENT ON COLUMN "pah_navigation_group"."createTime" IS '创建时间'; COMMENT ON COLUMN "pah_navigation_group"."updateTime" IS '更新时间'; COMMENT ON COLUMN "pah_navigation_group"."tenantId" IS '租户ID'; COMMENT ON COLUMN "pah_navigation_group"."groupKey" IS '稳定分组键'; COMMENT ON COLUMN "pah_navigation_group"."label" IS '分组名称'; COMMENT ON COLUMN "pah_navigation_group"."orderNum" IS '显示顺序'; COMMENT ON COLUMN "pah_navigation_group"."isBuiltin" IS '是否宿主内置'; COMMENT ON COLUMN "pah_navigation_group"."isEnabled" IS '是否参与工作台导航';

CREATE INDEX "IDX_9c91b552fae319d8c8985240fd" ON "pah_navigation_group" ("createTime") ;

CREATE INDEX "IDX_ae8b056d5418d94212bd7895ad" ON "pah_navigation_group" ("updateTime") ;

CREATE INDEX "IDX_da9dc150125475e41e0ed2458a" ON "pah_navigation_group" ("tenantId") ;

CREATE UNIQUE INDEX "IDX_ee0a384da836554755c593767a" ON "pah_navigation_group" ("groupKey") ;

CREATE TABLE "pah_navigation_group_assignment" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "targetKey" character varying NOT NULL, "groupId" integer NOT NULL, CONSTRAINT "PK_7c303e83282c43b67c7d4588883" PRIMARY KEY ("id")); COMMENT ON COLUMN "pah_navigation_group_assignment"."id" IS 'ID'; COMMENT ON COLUMN "pah_navigation_group_assignment"."createTime" IS '创建时间'; COMMENT ON COLUMN "pah_navigation_group_assignment"."updateTime" IS '更新时间'; COMMENT ON COLUMN "pah_navigation_group_assignment"."tenantId" IS '租户ID'; COMMENT ON COLUMN "pah_navigation_group_assignment"."targetKey" IS '目标稳定键'; COMMENT ON COLUMN "pah_navigation_group_assignment"."groupId" IS '归属大分组 ID';

CREATE INDEX "IDX_423a14a1aca89ee3d0ace78c27" ON "pah_navigation_group_assignment" ("createTime") ;

CREATE INDEX "IDX_c61021d8a77e486d0615aac6d0" ON "pah_navigation_group_assignment" ("updateTime") ;

CREATE INDEX "IDX_56e30f9c9ea2d0bf72c216a153" ON "pah_navigation_group_assignment" ("tenantId") ;

CREATE INDEX "IDX_50719265a65481ff42cd5f5a03" ON "pah_navigation_group_assignment" ("groupId") ;

CREATE UNIQUE INDEX "IDX_892ac1bd9af14eb24e874b3ff1" ON "pah_navigation_group_assignment" ("targetKey") ;

CREATE TABLE "pah_plugin_migration_record" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "moduleId" character varying NOT NULL, "migrationId" character varying NOT NULL, "version" integer NOT NULL, "checksum" character varying NOT NULL, "state" character varying NOT NULL, "importBatchId" character varying NOT NULL, "detail" text, "appliedAt" character varying NOT NULL, "rolledBackAt" character varying, CONSTRAINT "PK_b78c3cae8f2866018f6c2aab4c7" PRIMARY KEY ("id")); COMMENT ON COLUMN "pah_plugin_migration_record"."id" IS 'ID'; COMMENT ON COLUMN "pah_plugin_migration_record"."createTime" IS '创建时间'; COMMENT ON COLUMN "pah_plugin_migration_record"."updateTime" IS '更新时间'; COMMENT ON COLUMN "pah_plugin_migration_record"."tenantId" IS '租户ID'; COMMENT ON COLUMN "pah_plugin_migration_record"."moduleId" IS '插件模块 ID'; COMMENT ON COLUMN "pah_plugin_migration_record"."migrationId" IS 'manifest 迁移 ID'; COMMENT ON COLUMN "pah_plugin_migration_record"."version" IS '迁移声明版本'; COMMENT ON COLUMN "pah_plugin_migration_record"."checksum" IS '迁移声明校验和'; COMMENT ON COLUMN "pah_plugin_migration_record"."state" IS '迁移状态：applied 或 rolled-back'; COMMENT ON COLUMN "pah_plugin_migration_record"."importBatchId" IS '业务导入批次 ID'; COMMENT ON COLUMN "pah_plugin_migration_record"."detail" IS '迁移结果摘要'; COMMENT ON COLUMN "pah_plugin_migration_record"."appliedAt" IS '首次完成时间'; COMMENT ON COLUMN "pah_plugin_migration_record"."rolledBackAt" IS '回滚完成时间';

CREATE INDEX "IDX_2d35af3378d01cdb1015087db8" ON "pah_plugin_migration_record" ("createTime") ;

CREATE INDEX "IDX_6e720bff9487e0b760920b39db" ON "pah_plugin_migration_record" ("updateTime") ;

CREATE INDEX "IDX_13bcdb78ce4be9db79ff7a2312" ON "pah_plugin_migration_record" ("tenantId") ;

CREATE INDEX "IDX_f99dd20a2b6320c389ff087757" ON "pah_plugin_migration_record" ("moduleId") ;

CREATE UNIQUE INDEX "IDX_b638e479227c935afb58591d4d" ON "pah_plugin_migration_record" ("moduleId", "migrationId", "importBatchId") ;

CREATE TABLE "pah_plugin_menu_contribution" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "moduleId" character varying NOT NULL, "contributionKey" character varying NOT NULL, "menuId" integer NOT NULL, CONSTRAINT "PK_4ba5a9d3b8cf199e4cee150f649" PRIMARY KEY ("id")); COMMENT ON COLUMN "pah_plugin_menu_contribution"."id" IS 'ID'; COMMENT ON COLUMN "pah_plugin_menu_contribution"."createTime" IS '创建时间'; COMMENT ON COLUMN "pah_plugin_menu_contribution"."updateTime" IS '更新时间'; COMMENT ON COLUMN "pah_plugin_menu_contribution"."tenantId" IS '租户ID'; COMMENT ON COLUMN "pah_plugin_menu_contribution"."moduleId" IS '稳定插件模块 ID'; COMMENT ON COLUMN "pah_plugin_menu_contribution"."contributionKey" IS '清单内稳定贡献键'; COMMENT ON COLUMN "pah_plugin_menu_contribution"."menuId" IS '当前物化的系统菜单 ID';

CREATE INDEX "IDX_ba4a941edf9a2e809b28f9f2c1" ON "pah_plugin_menu_contribution" ("createTime") ;

CREATE INDEX "IDX_aa0e934d71945dad3e6745e234" ON "pah_plugin_menu_contribution" ("updateTime") ;

CREATE INDEX "IDX_2083aa0ee31da07dae4e6911af" ON "pah_plugin_menu_contribution" ("tenantId") ;

CREATE INDEX "IDX_a1512ed81a1c3d8fade44ce642" ON "pah_plugin_menu_contribution" ("moduleId") ;

CREATE INDEX "IDX_a4e0ac7b1c3852c957f2eca0ae" ON "pah_plugin_menu_contribution" ("menuId") ;

CREATE UNIQUE INDEX "IDX_0b171eaddd8094b67bf4a6421d" ON "pah_plugin_menu_contribution" ("moduleId", "contributionKey") ;

CREATE TABLE "pah_dictionary_reconcile_record" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "moduleId" character varying NOT NULL, "pluginVersion" character varying NOT NULL, "catalogHash" character varying NOT NULL, "actorId" character varying NOT NULL, "status" character varying NOT NULL, "detail" jsonb NOT NULL, "error" text, CONSTRAINT "PK_f2500fd483b3dc93d9fc32fa872" PRIMARY KEY ("id")); COMMENT ON COLUMN "pah_dictionary_reconcile_record"."id" IS 'ID'; COMMENT ON COLUMN "pah_dictionary_reconcile_record"."createTime" IS '创建时间'; COMMENT ON COLUMN "pah_dictionary_reconcile_record"."updateTime" IS '更新时间'; COMMENT ON COLUMN "pah_dictionary_reconcile_record"."tenantId" IS '租户ID'; COMMENT ON COLUMN "pah_dictionary_reconcile_record"."moduleId" IS '稳定插件模块 ID'; COMMENT ON COLUMN "pah_dictionary_reconcile_record"."pluginVersion" IS '插件版本'; COMMENT ON COLUMN "pah_dictionary_reconcile_record"."catalogHash" IS '产品字典 catalog SHA-256'; COMMENT ON COLUMN "pah_dictionary_reconcile_record"."actorId" IS '执行 Host 用户 ID'; COMMENT ON COLUMN "pah_dictionary_reconcile_record"."status" IS '执行状态'; COMMENT ON COLUMN "pah_dictionary_reconcile_record"."detail" IS 'dry-run 与结果快照'; COMMENT ON COLUMN "pah_dictionary_reconcile_record"."error" IS '失败原因';

CREATE INDEX "IDX_9a4c8983aa490ccab715fbff45" ON "pah_dictionary_reconcile_record" ("createTime") ;

CREATE INDEX "IDX_7a9dc7531d26deb0540b9bb4f1" ON "pah_dictionary_reconcile_record" ("updateTime") ;

CREATE INDEX "IDX_7d6d0a20602e8d8dfbc97897c8" ON "pah_dictionary_reconcile_record" ("tenantId") ;

CREATE INDEX "IDX_73c103a6089a0ce022f34fc56b" ON "pah_dictionary_reconcile_record" ("moduleId") ;

CREATE INDEX "IDX_895521c60a003fa24767eb5d63" ON "pah_dictionary_reconcile_record" ("catalogHash") ;

CREATE TABLE "dict_type" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "name" character varying NOT NULL, "key" character varying NOT NULL, "ownerModuleId" character varying(128), CONSTRAINT "PK_5009f151f6d1042a73d6d8d22c4" PRIMARY KEY ("id")); COMMENT ON COLUMN "dict_type"."id" IS 'ID'; COMMENT ON COLUMN "dict_type"."createTime" IS '创建时间'; COMMENT ON COLUMN "dict_type"."updateTime" IS '更新时间'; COMMENT ON COLUMN "dict_type"."tenantId" IS '租户ID'; COMMENT ON COLUMN "dict_type"."name" IS '名称'; COMMENT ON COLUMN "dict_type"."key" IS '标识'; COMMENT ON COLUMN "dict_type"."ownerModuleId" IS '所有者插件模块';

CREATE INDEX "IDX_69734e5c2d29cc2139d5078f2c" ON "dict_type" ("createTime") ;

CREATE INDEX "IDX_6cccb2e33846cd354e8dc0e0ef" ON "dict_type" ("updateTime") ;

CREATE INDEX "IDX_7d4f3d2336e1afdda38278a07e" ON "dict_type" ("tenantId") ;

CREATE UNIQUE INDEX "IDX_dd41d3e30f09704373c0745831" ON "dict_type" ("key") ;

CREATE TABLE "dict_info" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "typeId" integer NOT NULL, "name" character varying NOT NULL, "value" character varying, "orderNum" integer NOT NULL DEFAULT '0', "remark" character varying, "parentId" integer, "enabled" boolean NOT NULL DEFAULT true, "tags" text array NOT NULL DEFAULT '{}'::text[], "core" boolean NOT NULL DEFAULT false, "ownerModuleId" character varying(128), CONSTRAINT "PK_3925af826198dfce8b6472fc031" PRIMARY KEY ("id")); COMMENT ON COLUMN "dict_info"."id" IS 'ID'; COMMENT ON COLUMN "dict_info"."createTime" IS '创建时间'; COMMENT ON COLUMN "dict_info"."updateTime" IS '更新时间'; COMMENT ON COLUMN "dict_info"."tenantId" IS '租户ID'; COMMENT ON COLUMN "dict_info"."typeId" IS '类型ID'; COMMENT ON COLUMN "dict_info"."name" IS '名称'; COMMENT ON COLUMN "dict_info"."value" IS '值'; COMMENT ON COLUMN "dict_info"."orderNum" IS '排序'; COMMENT ON COLUMN "dict_info"."remark" IS '备注'; COMMENT ON COLUMN "dict_info"."parentId" IS '父ID'; COMMENT ON COLUMN "dict_info"."enabled" IS '是否启用'; COMMENT ON COLUMN "dict_info"."tags" IS '分类标签'; COMMENT ON COLUMN "dict_info"."core" IS '是否为受保护核心项'; COMMENT ON COLUMN "dict_info"."ownerModuleId" IS '所有者插件模块';

CREATE INDEX "IDX_5c311a4af30de1181a5d7a7cc2" ON "dict_info" ("createTime") ;

CREATE INDEX "IDX_10362a62adbf120821fff209d8" ON "dict_info" ("updateTime") ;

CREATE INDEX "IDX_c26dc4b1ccb26e642191995edd" ON "dict_info" ("tenantId") ;

CREATE UNIQUE INDEX "IDX_fde4371be829fb21213d81194b" ON "dict_info" ("typeId", "value") ;

CREATE TABLE "demo_goods" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "title" character varying(50) NOT NULL, "price" numeric(5,2) NOT NULL, "description" character varying, "mainImage" character varying, "type" integer NOT NULL, "status" integer NOT NULL DEFAULT '1', "exampleImages" json, "stock" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_7fd50d1a595340db729d5564fa6" PRIMARY KEY ("id")); COMMENT ON COLUMN "demo_goods"."id" IS 'ID'; COMMENT ON COLUMN "demo_goods"."createTime" IS '创建时间'; COMMENT ON COLUMN "demo_goods"."updateTime" IS '更新时间'; COMMENT ON COLUMN "demo_goods"."tenantId" IS '租户ID'; COMMENT ON COLUMN "demo_goods"."title" IS '标题'; COMMENT ON COLUMN "demo_goods"."price" IS '价格'; COMMENT ON COLUMN "demo_goods"."description" IS '描述'; COMMENT ON COLUMN "demo_goods"."mainImage" IS '主图'; COMMENT ON COLUMN "demo_goods"."type" IS '分类'; COMMENT ON COLUMN "demo_goods"."status" IS '状态'; COMMENT ON COLUMN "demo_goods"."exampleImages" IS '示例图'; COMMENT ON COLUMN "demo_goods"."stock" IS '库存';

CREATE INDEX "IDX_5075bf301ed9c39b5ca534231c" ON "demo_goods" ("createTime") ;

CREATE INDEX "IDX_82703e0477d1219261277df718" ON "demo_goods" ("updateTime") ;

CREATE INDEX "IDX_4773d4d34db0d601516da30bf3" ON "demo_goods" ("tenantId") ;

CREATE INDEX "IDX_85a70ee36c7c1b0a04bfa1ed27" ON "demo_goods" ("title") ;

CREATE TABLE "base_sys_user_role" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "userId" integer NOT NULL, "roleId" integer NOT NULL, CONSTRAINT "PK_ae4c555b94a0326c42b6ce71a46" PRIMARY KEY ("id")); COMMENT ON COLUMN "base_sys_user_role"."id" IS 'ID'; COMMENT ON COLUMN "base_sys_user_role"."createTime" IS '创建时间'; COMMENT ON COLUMN "base_sys_user_role"."updateTime" IS '更新时间'; COMMENT ON COLUMN "base_sys_user_role"."tenantId" IS '租户ID'; COMMENT ON COLUMN "base_sys_user_role"."userId" IS '用户ID'; COMMENT ON COLUMN "base_sys_user_role"."roleId" IS '角色ID';

CREATE INDEX "IDX_fa9555e03e42fce748c9046b1c" ON "base_sys_user_role" ("createTime") ;

CREATE INDEX "IDX_3e36c0d2b1a4c659c6b4fc64b3" ON "base_sys_user_role" ("updateTime") ;

CREATE INDEX "IDX_2f1dc0b6aad5604a2ddf37fba6" ON "base_sys_user_role" ("tenantId") ;

CREATE TABLE "base_sys_user" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "departmentId" integer, "userId" integer, "name" character varying, "username" character varying(100) NOT NULL, "password" character varying NOT NULL, "passwordV" integer NOT NULL DEFAULT '1', "nickName" character varying, "headImg" character varying, "phone" character varying(20), "email" character varying, "remark" character varying, "status" integer NOT NULL DEFAULT '1', "socketId" character varying, CONSTRAINT "PK_bc158670c4ab66bb902af4b225c" PRIMARY KEY ("id")); COMMENT ON COLUMN "base_sys_user"."id" IS 'ID'; COMMENT ON COLUMN "base_sys_user"."createTime" IS '创建时间'; COMMENT ON COLUMN "base_sys_user"."updateTime" IS '更新时间'; COMMENT ON COLUMN "base_sys_user"."tenantId" IS '租户ID'; COMMENT ON COLUMN "base_sys_user"."departmentId" IS '部门ID'; COMMENT ON COLUMN "base_sys_user"."userId" IS '创建者ID'; COMMENT ON COLUMN "base_sys_user"."name" IS '姓名'; COMMENT ON COLUMN "base_sys_user"."username" IS '用户名'; COMMENT ON COLUMN "base_sys_user"."password" IS '密码'; COMMENT ON COLUMN "base_sys_user"."passwordV" IS '密码版本, 作用是改完密码，让原来的token失效'; COMMENT ON COLUMN "base_sys_user"."nickName" IS '昵称'; COMMENT ON COLUMN "base_sys_user"."headImg" IS '头像'; COMMENT ON COLUMN "base_sys_user"."phone" IS '手机'; COMMENT ON COLUMN "base_sys_user"."email" IS '邮箱'; COMMENT ON COLUMN "base_sys_user"."remark" IS '备注'; COMMENT ON COLUMN "base_sys_user"."status" IS '状态 0-禁用 1-启用'; COMMENT ON COLUMN "base_sys_user"."socketId" IS 'socketId';

CREATE INDEX "IDX_ca8611d15a63d52aa4e292e46a" ON "base_sys_user" ("createTime") ;

CREATE INDEX "IDX_a0f2f19cee18445998ece93ddd" ON "base_sys_user" ("updateTime") ;

CREATE INDEX "IDX_94cb6e88070603ac6729d514fd" ON "base_sys_user" ("tenantId") ;

CREATE INDEX "IDX_0cf944da378d70a94f5fefd803" ON "base_sys_user" ("departmentId") ;

CREATE INDEX "IDX_40541b0502eb2422c73ae2aad1" ON "base_sys_user" ("userId") ;

CREATE UNIQUE INDEX "IDX_469ad55973f5b98930f6ad627b" ON "base_sys_user" ("username") ;

CREATE INDEX "IDX_9ec6d7ac6337eafb070e4881a8" ON "base_sys_user" ("phone") ;

CREATE TABLE "base_sys_role_menu" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "roleId" integer NOT NULL, "menuId" integer NOT NULL, CONSTRAINT "PK_44312aeaaacb4fe752e6dfc46bf" PRIMARY KEY ("id")); COMMENT ON COLUMN "base_sys_role_menu"."id" IS 'ID'; COMMENT ON COLUMN "base_sys_role_menu"."createTime" IS '创建时间'; COMMENT ON COLUMN "base_sys_role_menu"."updateTime" IS '更新时间'; COMMENT ON COLUMN "base_sys_role_menu"."tenantId" IS '租户ID'; COMMENT ON COLUMN "base_sys_role_menu"."roleId" IS '角色ID'; COMMENT ON COLUMN "base_sys_role_menu"."menuId" IS '菜单ID';

CREATE INDEX "IDX_3641f81d4201c524a57ce2aa54" ON "base_sys_role_menu" ("createTime") ;

CREATE INDEX "IDX_f860298298b26e7a697be36e5b" ON "base_sys_role_menu" ("updateTime") ;

CREATE INDEX "IDX_fd2d8bbe13949cfa56b1ed0a5d" ON "base_sys_role_menu" ("tenantId") ;

CREATE TABLE "base_sys_role_department" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "roleId" integer NOT NULL, "departmentId" integer NOT NULL, CONSTRAINT "PK_d51c868f1d6d1300e8019d9be55" PRIMARY KEY ("id")); COMMENT ON COLUMN "base_sys_role_department"."id" IS 'ID'; COMMENT ON COLUMN "base_sys_role_department"."createTime" IS '创建时间'; COMMENT ON COLUMN "base_sys_role_department"."updateTime" IS '更新时间'; COMMENT ON COLUMN "base_sys_role_department"."tenantId" IS '租户ID'; COMMENT ON COLUMN "base_sys_role_department"."roleId" IS '角色ID'; COMMENT ON COLUMN "base_sys_role_department"."departmentId" IS '部门ID';

CREATE INDEX "IDX_e881a66f7cce83ba431cf20194" ON "base_sys_role_department" ("createTime") ;

CREATE INDEX "IDX_cbf48031efee5d0de262965e53" ON "base_sys_role_department" ("updateTime") ;

CREATE INDEX "IDX_055658b2de49d547635e06f160" ON "base_sys_role_department" ("tenantId") ;

CREATE TABLE "base_sys_role" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "userId" character varying NOT NULL, "name" character varying NOT NULL, "label" character varying(50), "remark" character varying, "relevance" boolean NOT NULL DEFAULT false, "menuIdList" json NOT NULL, "departmentIdList" json NOT NULL, CONSTRAINT "PK_f51520240feced97cc423c4ef65" PRIMARY KEY ("id")); COMMENT ON COLUMN "base_sys_role"."id" IS 'ID'; COMMENT ON COLUMN "base_sys_role"."createTime" IS '创建时间'; COMMENT ON COLUMN "base_sys_role"."updateTime" IS '更新时间'; COMMENT ON COLUMN "base_sys_role"."tenantId" IS '租户ID'; COMMENT ON COLUMN "base_sys_role"."userId" IS '用户ID'; COMMENT ON COLUMN "base_sys_role"."name" IS '名称'; COMMENT ON COLUMN "base_sys_role"."label" IS '角色标签'; COMMENT ON COLUMN "base_sys_role"."remark" IS '备注'; COMMENT ON COLUMN "base_sys_role"."relevance" IS '数据权限是否关联上下级'; COMMENT ON COLUMN "base_sys_role"."menuIdList" IS '菜单权限'; COMMENT ON COLUMN "base_sys_role"."departmentIdList" IS '部门权限';

CREATE INDEX "IDX_6f01184441dec49207b41bfd92" ON "base_sys_role" ("createTime") ;

CREATE INDEX "IDX_d64ca209f3fc52128d9b20e97b" ON "base_sys_role" ("updateTime") ;

CREATE INDEX "IDX_953dc26a4e8bd5d9c989295796" ON "base_sys_role" ("tenantId") ;

CREATE UNIQUE INDEX "IDX_469d49a5998170e9550cf113da" ON "base_sys_role" ("name") ;

CREATE UNIQUE INDEX "IDX_f3f24fbbccf00192b076e549a7" ON "base_sys_role" ("label") ;

CREATE TABLE "base_sys_param" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "keyName" character varying NOT NULL, "name" character varying NOT NULL, "data" text NOT NULL, "dataType" integer NOT NULL DEFAULT '0', "remark" character varying, CONSTRAINT "PK_6107bf64e5451af7c84fa242242" PRIMARY KEY ("id")); COMMENT ON COLUMN "base_sys_param"."id" IS 'ID'; COMMENT ON COLUMN "base_sys_param"."createTime" IS '创建时间'; COMMENT ON COLUMN "base_sys_param"."updateTime" IS '更新时间'; COMMENT ON COLUMN "base_sys_param"."tenantId" IS '租户ID'; COMMENT ON COLUMN "base_sys_param"."keyName" IS '键'; COMMENT ON COLUMN "base_sys_param"."name" IS '名称'; COMMENT ON COLUMN "base_sys_param"."data" IS '数据'; COMMENT ON COLUMN "base_sys_param"."dataType" IS '数据类型 0-字符串 1-富文本 2-文件 '; COMMENT ON COLUMN "base_sys_param"."remark" IS '备注';

CREATE INDEX "IDX_7bcb57371b481d8e2d66ddeaea" ON "base_sys_param" ("createTime") ;

CREATE INDEX "IDX_479122e3bf464112f7a7253dac" ON "base_sys_param" ("updateTime") ;

CREATE INDEX "IDX_8a0ab598ca7d63475356ca1157" ON "base_sys_param" ("tenantId") ;

CREATE UNIQUE INDEX "IDX_cf19b5e52d8c71caa9c4534454" ON "base_sys_param" ("keyName") ;

CREATE TABLE "base_sys_menu" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "parentId" integer, "name" character varying NOT NULL, "router" character varying, "perms" text, "type" integer NOT NULL DEFAULT '0', "icon" character varying, "orderNum" integer NOT NULL DEFAULT '0', "viewPath" character varying, "keepAlive" boolean NOT NULL DEFAULT true, "isShow" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_d340a4bb3f8be8b2896536b2ec7" PRIMARY KEY ("id")); COMMENT ON COLUMN "base_sys_menu"."id" IS 'ID'; COMMENT ON COLUMN "base_sys_menu"."createTime" IS '创建时间'; COMMENT ON COLUMN "base_sys_menu"."updateTime" IS '更新时间'; COMMENT ON COLUMN "base_sys_menu"."tenantId" IS '租户ID'; COMMENT ON COLUMN "base_sys_menu"."parentId" IS '父菜单ID'; COMMENT ON COLUMN "base_sys_menu"."name" IS '菜单名称'; COMMENT ON COLUMN "base_sys_menu"."router" IS '菜单地址'; COMMENT ON COLUMN "base_sys_menu"."perms" IS '权限标识'; COMMENT ON COLUMN "base_sys_menu"."type" IS '类型 0-目录 1-菜单 2-按钮'; COMMENT ON COLUMN "base_sys_menu"."icon" IS '图标'; COMMENT ON COLUMN "base_sys_menu"."orderNum" IS '排序'; COMMENT ON COLUMN "base_sys_menu"."viewPath" IS '视图地址'; COMMENT ON COLUMN "base_sys_menu"."keepAlive" IS '路由缓存'; COMMENT ON COLUMN "base_sys_menu"."isShow" IS '是否显示';

CREATE INDEX "IDX_05e3d6a56604771a6da47ebf8e" ON "base_sys_menu" ("createTime") ;

CREATE INDEX "IDX_d5203f18daaf7c3fe0ab34497f" ON "base_sys_menu" ("updateTime") ;

CREATE INDEX "IDX_2087f9610c1fc5a184bedaacef" ON "base_sys_menu" ("tenantId") ;

CREATE TABLE "base_sys_log" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "userId" integer, "action" character varying NOT NULL, "ip" character varying, "params" json, CONSTRAINT "PK_9a1635db425d22a297fd3c293ad" PRIMARY KEY ("id")); COMMENT ON COLUMN "base_sys_log"."id" IS 'ID'; COMMENT ON COLUMN "base_sys_log"."createTime" IS '创建时间'; COMMENT ON COLUMN "base_sys_log"."updateTime" IS '更新时间'; COMMENT ON COLUMN "base_sys_log"."tenantId" IS '租户ID'; COMMENT ON COLUMN "base_sys_log"."userId" IS '用户ID'; COMMENT ON COLUMN "base_sys_log"."action" IS '行为'; COMMENT ON COLUMN "base_sys_log"."ip" IS 'ip'; COMMENT ON COLUMN "base_sys_log"."params" IS '参数';

CREATE INDEX "IDX_c9382b76219a1011f7b8e7bcd1" ON "base_sys_log" ("createTime") ;

CREATE INDEX "IDX_bfd44e885b470da43bcc39aaa7" ON "base_sys_log" ("updateTime") ;

CREATE INDEX "IDX_384bde153859845bf0dcdc00f6" ON "base_sys_log" ("tenantId") ;

CREATE INDEX "IDX_51a2caeb5713efdfcb343a8772" ON "base_sys_log" ("userId") ;

CREATE INDEX "IDX_938f886fb40e163db174b7f6c3" ON "base_sys_log" ("action") ;

CREATE INDEX "IDX_24e18767659f8c7142580893f2" ON "base_sys_log" ("ip") ;

CREATE TABLE "base_sys_department" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "name" character varying NOT NULL, "userId" integer, "parentId" integer, "orderNum" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_df6e3a2c01406d8670ada6a68d9" PRIMARY KEY ("id")); COMMENT ON COLUMN "base_sys_department"."id" IS 'ID'; COMMENT ON COLUMN "base_sys_department"."createTime" IS '创建时间'; COMMENT ON COLUMN "base_sys_department"."updateTime" IS '更新时间'; COMMENT ON COLUMN "base_sys_department"."tenantId" IS '租户ID'; COMMENT ON COLUMN "base_sys_department"."name" IS '部门名称'; COMMENT ON COLUMN "base_sys_department"."userId" IS '创建者ID'; COMMENT ON COLUMN "base_sys_department"."parentId" IS '上级部门ID'; COMMENT ON COLUMN "base_sys_department"."orderNum" IS '排序';

CREATE INDEX "IDX_be4c53cd671384fa588ca9470a" ON "base_sys_department" ("createTime") ;

CREATE INDEX "IDX_ca1473a793961ec55bc0c8d268" ON "base_sys_department" ("updateTime") ;

CREATE INDEX "IDX_f19e8ffd9c62ddb17e76c8b9d7" ON "base_sys_department" ("tenantId") ;

CREATE INDEX "IDX_f5fb5ac30b3609c27af3517727" ON "base_sys_department" ("userId") ;

CREATE TABLE "base_sys_conf" ("id" SERIAL NOT NULL, "createTime" character varying NOT NULL, "updateTime" character varying NOT NULL, "tenantId" integer, "cKey" character varying NOT NULL, "cValue" character varying NOT NULL, CONSTRAINT "PK_0f98b7fb11bc5657ef55392c09a" PRIMARY KEY ("id")); COMMENT ON COLUMN "base_sys_conf"."id" IS 'ID'; COMMENT ON COLUMN "base_sys_conf"."createTime" IS '创建时间'; COMMENT ON COLUMN "base_sys_conf"."updateTime" IS '更新时间'; COMMENT ON COLUMN "base_sys_conf"."tenantId" IS '租户ID'; COMMENT ON COLUMN "base_sys_conf"."cKey" IS '配置键'; COMMENT ON COLUMN "base_sys_conf"."cValue" IS '配置值';

CREATE INDEX "IDX_905208f206a3ff9fd513421971" ON "base_sys_conf" ("createTime") ;

CREATE INDEX "IDX_4c6f27f6ecefe51a5a196a047a" ON "base_sys_conf" ("updateTime") ;

CREATE INDEX "IDX_03fc424a2f8093a538730a7ff2" ON "base_sys_conf" ("tenantId") ;

CREATE UNIQUE INDEX "IDX_9be195d27767b4485417869c3a" ON "base_sys_conf" ("cKey") ;
