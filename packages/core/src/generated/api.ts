export interface paths {
    "/healthz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Check whether the API process is alive */
        get: operations["healthCheck"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/readyz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Check database and migration readiness */
        get: operations["readinessCheck"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/meta/get": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Get runtime and environment metadata */
        post: operations["getBackendMeta"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operations/call": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Call a typed oneVegetable operation */
        post: operations["callOperation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/product-mutation-jobs/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** List durable product mutation jobs */
        post: operations["listProductMutationJobs"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/product-mutation-jobs/get": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Get one durable product mutation job */
        post: operations["getProductMutationJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/product-mutation-jobs/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Refresh one product mutation job from Alibaba readback */
        post: operations["refreshProductMutationJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/session/get": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Get the current opaque session */
        post: operations["getAuthSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/bootstrap": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create the first local administrator */
        post: operations["bootstrapAdmin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create an opaque local session */
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke the current opaque session */
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/password/change": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Change the current user password */
        post: operations["changePassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** List local users */
        post: operations["listAdminUsers"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users/create": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a local user */
        post: operations["createAdminUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users/update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Update a local user */
        post: operations["updateAdminUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users/password/reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reset a local user password */
        post: operations["resetAdminUserPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users/sessions/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke all sessions for a local user */
        post: operations["revokeAdminUserSessions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/audit-events/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** List append-only audit events */
        post: operations["listAdminAuditEvents"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/system/get": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Get protected system metadata */
        post: operations["getAdminSystem"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/policy-summary/get": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Get the read-only ABAC policy summary */
        post: operations["getAdminPolicySummary"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/request-events/list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** List redacted request diagnostics */
        post: operations["listAdminRequestEvents"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/request-events/purge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Purge request diagnostics outside the retention window */
        post: operations["purgeAdminRequestEvents"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AdminAuditListRequest: {
            requestId: components["schemas"]["RequestId"];
            requestIdFilter?: components["schemas"]["RequestId"];
            actorId?: string;
            action?: string;
            /** @enum {string} */
            outcome?: "success" | "error" | "denied";
            fromTimeUtc?: number;
            toTimeUtc?: number;
            /** @default 1 */
            page: number;
            /** @default 20 */
            pageSize: number;
        };
        AdminPasswordResetRequest: {
            requestId: components["schemas"]["RequestId"];
            /** Format: uuid */
            userId: string;
            revision: number;
            newPassword?: string;
        };
        AdminRequestEventListRequest: {
            requestId: components["schemas"]["RequestId"];
            requestIdFilter?: components["schemas"]["RequestId"];
            actorId?: string;
            route?: string;
            operation?: string;
            /** @enum {string} */
            outcome?: "success" | "error" | "denied";
            fromTimeUtc?: number;
            toTimeUtc?: number;
            /** @default 1 */
            page: number;
            /** @default 20 */
            pageSize: number;
        };
        AdminUserCreateRequest: {
            requestId: components["schemas"]["RequestId"];
            username: string;
            password: string;
            role: components["schemas"]["UserRole"];
            remark?: string | null;
        };
        AdminUserTargetRequest: {
            requestId: components["schemas"]["RequestId"];
            /** Format: uuid */
            userId: string;
        };
        AdminUserUpdateRequest: {
            requestId: components["schemas"]["RequestId"];
            /** Format: uuid */
            userId: string;
            role: components["schemas"]["UserRole"];
            status: components["schemas"]["UserStatus"];
            revision: number;
            remark: string | null;
        };
        AlibabaGatewayStatus: {
            /** @enum {string} */
            source: "environment" | "documentation-replay";
            configured: boolean;
            hasAppKey: boolean;
            hasAppSecret: boolean;
            hasAccessToken: boolean;
            endpointOrigin: string;
            /** @enum {string} */
            signMethod: "hmac" | "md5" | "hmac-sha256";
            realReadEnabled: boolean;
            /** @constant */
            mutationEnabled: false;
        };
        /** alibaba.icbu.diagnostic.supplier.rank.getpercent request */
        AlibabaInsightsAlibabaIcbuDiagnosticSupplierRankGetpercentRequest: Record<string, never>;
        /** alibaba.icbu.diagnostic.supplier.rank.getpercent response */
        AlibabaInsightsAlibabaIcbuDiagnosticSupplierRankGetpercentResponse: {
            /** @description 供应商排名时间序列容器 */
            rank_info_list?: {
                /** @description 供应商排名时间序列 */
                rank_info?: {
                    /** @description 统计日期 */
                    stat_date?: string;
                    /** @description 全站排名百分比 */
                    percent?: number;
                }[];
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.mydata.self.query.cgsokk request */
        AlibabaInsightsAlibabaMydataSelfQueryCgsokkRequest: {
            /** @description 小满数据源 */
            data_source: string;
            /** @description JSON 字段列表 */
            fields?: string;
            /** @description 统一社会信用代码 */
            social_credit_code: string;
            /** @description 合作方业务密钥，仅允许 service worker 注入 */
            app_secret: string;
            /** @description 合作方应用信息 */
            app_info: string;
        };
        /** alibaba.mydata.self.query.cgsokk response */
        AlibabaInsightsAlibabaMydataSelfQueryCgsokkResponse: {
            /** @description 接口返回model */
            result?: {
                /** @description 返回码 */
                return_code?: number;
                /** @description 返回字段以及值 */
                return_values?: string[];
                /** @description 异常栈 */
                return_error_stack_trace?: string;
                /** @description 成功与否 */
                successed?: boolean;
                /** @description msg */
                return_message?: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.procurement.mysupplier.list request */
        AlibabaInsightsAlibabaProcurementMysupplierListRequest: {
            /** @description 当前页数，0开始 */
            current_page: number;
            /** @description 请求页大小，默认10 */
            page_size?: number;
            /** @description 请求类型，例如订单order */
            type: string;
        };
        /** alibaba.procurement.mysupplier.list response */
        AlibabaInsightsAlibabaProcurementMysupplierListResponse: {
            /** @description 结果大对象 */
            result?: {
                /** @description 当前页 */
                curr_page: number;
                /** @description 错误码 */
                error_code: string;
                /** @description 错误信息 */
                error_msg: string;
                /** @description 请求页数 */
                page_size: number;
                /** @description 是否成功 */
                success: boolean;
                /** @description 加密后的供应商id */
                supplier_id_enc_list: string[];
                /** @description 总个数 */
                total_item: number;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.procurement.supplier.items.get request */
        AlibabaInsightsAlibabaProcurementSupplierItemsGetRequest: {
            /** @description 请求query */
            product_list_query?: {
                /** @description 开始日期(unix时间戳，单位ms) */
                date_end?: number;
                /** @description 结束日期(unix时间戳，单位ms) */
                date_start?: number;
                /** @description 请求页 */
                page_index: number;
                /** @description 页大小 */
                page_size?: number;
                /** @description 供应商加密id */
                seller_account_id: string;
                /** @description 类型 */
                type: string;
            };
        };
        /** alibaba.procurement.supplier.items.get response */
        AlibabaInsightsAlibabaProcurementSupplierItemsGetResponse: {
            /** @description 返回结果 */
            result?: {
                /** @description 请求页 */
                curr_page: number;
                /** @description 错误码 */
                error_code: string;
                /** @description 错误信息 */
                error_msg: string;
                /** @description 页大小 */
                page_size: number;
                /** @description 产品列表 */
                product_list: {
                    /** @description 产品类目 */
                    category: number;
                    /** @description 产品详情描述 */
                    description: string;
                    /** @description 产品id */
                    id: number;
                    /** @description 价格区间 */
                    price_range: string;
                    /** @description 价格单位 */
                    price_unit: number;
                    /** @description 产品详情页的url */
                    product_detail_url: string;
                    /** @description 产品发布时间 */
                    publish_time: number | string;
                    /** @description sku */
                    sku: {
                        /** @description sku属性 */
                        attributes: {
                            /** @description 属性id */
                            attribute_id: number;
                            /** @description 属性名字 */
                            attribute_name: string;
                            /** @description 自定义sku链接 */
                            sku_custom_image_url: string;
                            /** @description 自定义属性名 */
                            sku_custom_value_name: string;
                            /** @description 属性值iid */
                            value_id: number;
                            /** @description 属性值名称 */
                            value_name: string;
                        }[];
                    };
                    /** @description 商品标题 */
                    subject: string;
                }[];
                /** @description 是否成功 */
                success: boolean;
                /** @description 订单数量总计 */
                total_order_count: number;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.onetouch.logistics.buyer.info.get request */
        AlibabaLogisticsAlibabaOnetouchLogisticsBuyerInfoGetRequest: Record<string, never>;
        /** alibaba.onetouch.logistics.buyer.info.get response */
        AlibabaLogisticsAlibabaOnetouchLogisticsBuyerInfoGetResponse: {
            /** @description 接口返回model */
            result?: {
                /** @description code */
                code: string;
                /** @description 返回素材id */
                data: {
                    [key: string]: unknown;
                };
                /** @description 是否成功 */
                success: boolean;
                /** @description message */
                message: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.onetouch.logistics.express.address.city.list request */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressAddressCityListRequest: {
            /** @description 请求参数 */
            param_query: {
                /** @description 省ID */
                province_id: number;
            };
        };
        /** alibaba.onetouch.logistics.express.address.city.list response */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressAddressCityListResponse: {
            /** @description 接口返回model */
            result?: {
                /** @description 返回结果描述 */
                error_message?: string;
                /** @description 列表对象 */
                values?: {
                    /** @description 节点ID */
                    area_id?: number;
                    /** @description 节点名称拼音 */
                    pinyin?: string;
                    /** @description 上级节点ID */
                    parent_id?: number;
                    /** @description 中文名称 */
                    name?: string;
                    /** @description 层级 */
                    level?: number;
                    /** @description 上级节点名称 */
                    parent_name?: string;
                }[];
                /** @description 是否成功 */
                success?: boolean;
                /** @description 返回结果编码 */
                error_code?: number;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.onetouch.logistics.express.address.division.list request */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressAddressDivisionListRequest: {
            /** @description 请求参数 */
            param_query: {
                /** @description 城市id */
                city_id: number;
                /** @description 是否包含子节点 */
                with_children: boolean;
            };
        };
        /** alibaba.onetouch.logistics.express.address.division.list response */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressAddressDivisionListResponse: {
            /** @description 接口返回model */
            result?: {
                /** @description 返回结果描述 */
                error_message?: string;
                /** @description 列表对象 */
                values?: {
                    /** @description 邮编 */
                    zip?: string;
                    /** @description 节点名称拼音 */
                    pinyin?: string;
                    /** @description 层级 */
                    level?: number;
                    /** @description id */
                    id?: number;
                    /** @description 上级节点ID */
                    parent_id?: number;
                    /** @description 子节点列表 */
                    childrens?: {
                        /** @description 节点id */
                        id?: number;
                        /** @description 节点名称拼音 */
                        pinyin?: string;
                        /** @description 上级节点ID */
                        parent_id?: number;
                        /** @description 中文名称 */
                        name?: string;
                        /** @description 层级 */
                        level?: number;
                    }[];
                    /** @description 节点名称 */
                    name?: string;
                };
                /** @description 是否成功 */
                success?: boolean;
                /** @description 返回结果编码 */
                error_code?: number;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.onetouch.logistics.express.address.province.list request */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressAddressProvinceListRequest: {
            /** @description 请求参数 */
            param_query: {
                /** @description 国家code */
                country_code: string;
            };
        };
        /** alibaba.onetouch.logistics.express.address.province.list response */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressAddressProvinceListResponse: {
            /** @description 接口返回model */
            result?: {
                /** @description 返回结果描述 */
                error_message?: string;
                /** @description 列表对象 */
                values?: {
                    /** @description 上级节点名称 */
                    parent_name?: string;
                    /** @description 层级 */
                    level?: number;
                    /** @description 中文名称 */
                    name?: string;
                    /** @description 上级节点ID */
                    parent_id?: number;
                    /** @description 节点名称拼音 */
                    pinyin?: string;
                    /** @description 节点ID */
                    area_id?: number;
                }[];
                /** @description 是否成功 */
                success?: boolean;
                /** @description 返回结果编码 */
                error_code?: number;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.onetouch.logistics.express.address.street.list request */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressAddressStreetListRequest: {
            /** @description 请求参数 */
            param_query: {
                /** @description 查询关键词 */
                search_text: string;
            };
        };
        /** alibaba.onetouch.logistics.express.address.street.list response */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressAddressStreetListResponse: {
            /** @description 接口返回model */
            result?: {
                /** @description 返回结果描述 */
                error_message?: string;
                /** @description 列表对象 */
                values?: {
                    /** @description 邮编 */
                    zip?: string;
                    /** @description 地址 */
                    address?: string;
                }[];
                /** @description 是否成功 */
                success?: boolean;
                /** @description 返回结果编码 */
                error_code?: number;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.onetouch.logistics.express.charge.calculate request */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressChargeCalculateRequest: {
            /** @description 请求参数对象 */
            paramn_query: {
                /** @description 货品信息 */
                cargo_list: {
                    /** @description 单位 */
                    unit: string;
                    /** @description 海关编码 */
                    hscode: string;
                    /** @description 货物数量 */
                    quantity: number;
                    /** @description 1 */
                    declaration_value: string;
                    /** @description 货物单价 */
                    price?: string;
                    /** @description 货物中文名 */
                    name_cn: string;
                    /** @description 1 */
                    currency: string;
                    /** @description 货物英文名 */
                    name_en: string;
                    /** @description 商品特性列表对象 */
                    product_type: {
                        /** @description 商品类型code */
                        code: string;
                        /** @description 商品特性列表对象 */
                        children?: {
                            /** @description 商品类型code */
                            code?: string;
                            /** @description 商品特性列表对象 */
                            children?: {
                                /** @description 商品类型code */
                                code?: string;
                                /** @description 商品类型 */
                                name?: string;
                            }[];
                            /** @description 商品类型 */
                            name?: string;
                        }[];
                        /** @description 商品类型 */
                        name: string;
                    }[];
                    /** @description 材质 */
                    material?: string;
                    /** @description 用途 */
                    purpose?: string;
                }[];
                /** @description 起始地邮编 */
                origin_zip_code: string;
                /** @description 交货到仓快递信息 */
                deliver_warehouse_express?: {
                    /** @description 国内快递公司code */
                    logistics_company?: string;
                    /** @description 运单号 */
                    tracking_numbers?: string[];
                    /** @description 包裹数量 */
                    package_quantity?: string;
                };
                /** @description 包裹信息 */
                package_list: {
                    /** @description 数量 */
                    quantity: string;
                    /** @description 长 */
                    length: string;
                    /** @description 宽 */
                    width: string;
                    /** @description 重量 */
                    weight: string;
                    /** @description 包装类型 */
                    type: string;
                    /** @description 高 */
                    height: string;
                }[];
                /** @description 目的地国家 */
                destination_country_code: string;
                /** @description 仓库编码 */
                warehouse_code: string;
                /** @description 产品编码 */
                product_code: string;
                /** @description 发货人地址 */
                consignor_address: {
                    /** @description 国家、省、市、详细地址信息 */
                    address: {
                        /** @description 邮编 */
                        zip: string;
                        /** @description 国家 */
                        country: {
                            /** @description 地址代码 */
                            code: string;
                            /** @description 地址id */
                            area_id?: number;
                            /** @description 地址名字 */
                            name: string;
                        };
                        /** @description 地址 */
                        address: string;
                        /** @description 乡、镇名称 */
                        town?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址id */
                            area_id?: number;
                            /** @description 地址名字 */
                            name?: string;
                        };
                        /** @description 省份 */
                        province: {
                            /** @description 地址代码 */
                            code: string;
                            /** @description 地址id */
                            area_id?: number;
                            /** @description 地址名字 */
                            name: string;
                        };
                        /** @description 城市 */
                        city: {
                            /** @description 地址代码 */
                            code: string;
                            /** @description 地址id */
                            area_id?: number;
                            /** @description 地址名字 */
                            name: string;
                        };
                        /** @description 地区 */
                        district?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址名字 */
                            name?: string;
                        };
                    };
                    /** @description 联系方式(邮箱、电话号码、手机号码等) */
                    contact: {
                        /** @description 电话区号 */
                        phone_code?: string;
                        /** @description 手机号码 */
                        mobile_no: string;
                        /** @description 邮箱 */
                        email: string;
                    };
                    /** @description 联系人姓名 */
                    contact_person: string;
                    /** @description 公司中文名 */
                    company_name_cn: string;
                };
                /** @description 申报信息 */
                express_customs: {
                    /** @description 申报金额 */
                    declaration_amount: string;
                    /** @description 是否正式报关 */
                    need_customs_clearance: string;
                    /** @description 报关币种，出口发货中心默认USD */
                    declaration_currency: string;
                };
                /** @description 1 */
                need_pickup?: boolean;
                /** @description 目的地邮编 */
                destination_zip_code: string;
                /** @description 发货批次ID */
                supply_chain_biz_id?: string;
                /** @description 收货人地址 */
                consignee_address: {
                    /** @description 国家、省、市、详细地址信息 */
                    address: {
                        /** @description 邮编 */
                        zip: string;
                        /** @description 国家 */
                        country: {
                            /** @description 地址代码 */
                            code: string;
                            /** @description 地址id */
                            area_id?: number;
                            /** @description 地址名字 */
                            name: string;
                            /** @description 未知 */
                            phone_code?: string;
                        };
                        /** @description 地址 */
                        address: string;
                        /** @description 省份 */
                        province: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址代码 */
                            area_id?: string;
                            /** @description 地址名字 */
                            name: string;
                        };
                        /** @description 乡、镇名称 */
                        town?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址代码 */
                            area_id?: string;
                            /** @description 地址名字 */
                            name?: string;
                        };
                        /** @description 地址2 */
                        address2?: string;
                        /** @description 城市 */
                        city: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址名字 */
                            name: string;
                        };
                        /** @description 地区 */
                        district?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址代码 */
                            area_id?: string;
                            /** @description 地址名字 */
                            name?: string;
                        };
                    };
                    /** @description 联系方式(邮箱、电话号码、手机号码等) */
                    contact?: {
                        /** @description 电话区码 */
                        phone_area?: string;
                        /** @description 电话区号 */
                        phone_code?: string;
                        /** @description 手机号码 */
                        mobile_no: string;
                        /** @description 邮箱 */
                        email: string;
                    };
                    /** @description 地址所有者邮箱(卖家维护收货地址, 值等于买家邮箱) */
                    address_email?: string;
                    /** @description 公司英文名 */
                    company_name_en: string;
                    /** @description 联系人姓名 */
                    contact_person: string;
                    /** @description 地址类型 */
                    type?: string;
                };
                /** @description 交易单号（例如阿里国际站的信保单ID），注意此字段不为空时，trade_platform字段必填（默认为ICBU） */
                trade_biz_id?: string;
                /** @description 跨境电商平台代码：ICBU（阿里巴巴国际站）、ALIEXPRESS（速卖通）、AMAZON（亚马逊）等 */
                trade_platform?: string;
            };
        };
        /** alibaba.onetouch.logistics.express.charge.calculate response */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressChargeCalculateResponse: {
            /** @description 接口返回model */
            result?: {
                /** @description 返回结果描述 */
                error_message?: string;
                /** @description 结果对象 */
                values?: {
                    /** @description 费用项列表 */
                    express_quote_item_list?: {
                        /** @description 费用编码 */
                        code?: string;
                        /** @description 数量 */
                        quantity?: number;
                        /** @description 价格信息 */
                        sales_amount?: {
                            /** @description 金额 */
                            amount?: string;
                            /** @description 币种 */
                            currency?: string;
                        };
                        /** @description 费用名称 */
                        name?: string;
                        /** @description 费用描述 */
                        charge_desc?: string;
                        /** @description 币种 */
                        currency?: string;
                        /** @description 费用类型 */
                        type?: string;
                    }[];
                    /** @description 销售总价 */
                    sales_amount?: string;
                    /** @description 折扣总价 */
                    discount_amount?: string;
                };
                /** @description 是否成功 */
                success?: boolean;
                /** @description 返回结果编码 */
                error_code?: number;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.onetouch.logistics.express.logistics.order.create request */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressLogisticsOrderCreateRequest: {
            /** @description 请求参数对象 */
            paramn_query: {
                /** @description 货品信息 */
                cargo_list: {
                    /** @description 单位 */
                    unit: string;
                    /** @description 海关编码 */
                    hscode: string;
                    /** @description 货物数量 */
                    quantity: number;
                    /** @description 申报单价 */
                    declaration_value: string;
                    /** @description 货物单价 */
                    price?: string;
                    /** @description 货物中文名 */
                    name_cn: string;
                    /** @description 币种 */
                    currency: string;
                    /** @description 货物英文名 */
                    name_en: string;
                    /** @description 商品特性列表对象 */
                    product_type: {
                        /** @description 商品类型code */
                        code: string;
                        /** @description 商品特性列表对象 */
                        children?: {
                            /** @description 商品类型code */
                            code?: string;
                            /** @description 商品特性列表对象 */
                            children?: {
                                /** @description 商品类型code */
                                code?: string;
                                /** @description 商品类型 */
                                name?: string;
                            }[];
                            /** @description 商品类型 */
                            name?: string;
                        }[];
                        /** @description 商品类型 */
                        name: string;
                    }[];
                    /** @description 用途 */
                    purpose: string;
                    /** @description 材质 */
                    material: string;
                }[];
                /** @description 起始地邮编 */
                origin_zip_code: string;
                /** @description 交货到仓快递信息（自寄必填） */
                deliver_warehouse_express?: {
                    /** @description 国内快递公司code（自寄必填） */
                    logistics_company?: string;
                    /** @description 运单号（自寄必填） */
                    tracking_numbers?: string[];
                    /** @description 包裹数量（自寄必填） */
                    package_quantity?: string;
                };
                /** @description 包裹信息 */
                package_list: {
                    /** @description 数量 */
                    quantity: string;
                    /** @description 长，单位：cm */
                    length: string;
                    /** @description 宽，单位：cm */
                    width: string;
                    /** @description 重量，单位：kg */
                    weight: string;
                    /** @description 包装类型 */
                    type: string;
                    /** @description 高，单位：cm */
                    height: string;
                }[];
                /** @description 目的地国家 */
                destination_country_code: string;
                /** @description 仓库编码 */
                warehouse_code: string;
                /** @description 产品编码 */
                product_code: string;
                /** @description 发货人地址 */
                consignor_address: {
                    /** @description 国家、省、市、详细地址信息 */
                    address: {
                        /** @description 邮编 */
                        zip: string;
                        /** @description 国家 */
                        country: {
                            /** @description 地址代码 */
                            code: string;
                            /** @description 地址id */
                            area_id?: number;
                            /** @description 地址名字 */
                            name: string;
                        };
                        /** @description 地址 */
                        address: string;
                        /** @description 乡、镇名称 */
                        town?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址id */
                            area_id?: number;
                            /** @description 地址名字 */
                            name?: string;
                        };
                        /** @description 省份 */
                        province: {
                            /** @description 地址代码 */
                            code: string;
                            /** @description 地址id */
                            area_id?: number;
                            /** @description 地址名字 */
                            name: string;
                        };
                        /** @description 城市 */
                        city: {
                            /** @description 地址代码 */
                            code: string;
                            /** @description 地址id */
                            area_id?: number;
                            /** @description 地址名字 */
                            name: string;
                        };
                        /** @description 地区 */
                        district?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址名字 */
                            name?: string;
                        };
                    };
                    /** @description 联系方式(邮箱、电话号码、手机号码等) */
                    contact: {
                        /** @description 电话区号 */
                        phone_code?: string;
                        /** @description 手机号码 */
                        mobile_no: string;
                        /** @description 邮箱 */
                        email: string;
                    };
                    /** @description 联系人姓名 */
                    contact_person: string;
                    /** @description 公司中文名 */
                    company_name_cn: string;
                };
                /** @description 申报信息 */
                express_customs: {
                    /** @description 申报金额 */
                    declaration_amount: string;
                    /** @description 是否正式报关 */
                    need_customs_clearance: string;
                    /** @description 报关币种，出口发货中心默认USD */
                    declaration_currency: string;
                    /** @description 增值税类型，枚举取值：VAT、IOSS、VOEC */
                    vat_type?: string;
                    /** @description 增值税税号 */
                    vat_number?: string;
                    /** @description 纳税人识别号 */
                    taxpayer_id?: string;
                    /** @description 欧盟EORI */
                    eori_number?: string;
                };
                /** @description 是否上门揽收 */
                need_pickup?: boolean;
                /** @description 目的地邮编 */
                destination_zip_code: string;
                /** @description 发货批次ID，阿里国际站订单发货此字段为必填 */
                supply_chain_biz_id: string;
                /** @description 收货人地址 */
                consignee_address: {
                    /** @description 国家、省、市、详细地址信息 */
                    address: {
                        /** @description 邮编 */
                        zip: string;
                        /** @description 国家 */
                        country: {
                            /** @description 地址代码 */
                            code: string;
                            /** @description 地址id */
                            area_id?: number;
                            /** @description 地址名字 */
                            name: string;
                            /** @description 未知 */
                            phone_code?: string;
                        };
                        /** @description 地址 */
                        address: string;
                        /** @description 省份 */
                        province: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址id */
                            area_id?: string;
                            /** @description 地址名字 */
                            name: string;
                        };
                        /** @description 乡、镇名称 */
                        town?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址id */
                            area_id?: string;
                            /** @description 地址名字 */
                            name?: string;
                        };
                        /** @description 地址2 */
                        address2?: string;
                        /** @description 城市 */
                        city: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址名字 */
                            name: string;
                        };
                        /** @description 地区 */
                        district?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址id */
                            area_id?: string;
                            /** @description 地址名字 */
                            name?: string;
                        };
                    };
                    /** @description 联系方式(邮箱、电话号码、手机号码等) */
                    contact: {
                        /** @description 电话区码 */
                        phone_area?: string;
                        /** @description 电话区号 */
                        phone_code?: string;
                        /** @description 手机号码 */
                        mobile_no: string;
                        /** @description 邮箱 */
                        email?: string;
                    };
                    /** @description 地址所有者邮箱(卖家维护收货地址, 值等于买家邮箱) */
                    address_email?: string;
                    /** @description 公司英文名 */
                    company_name_en: string;
                    /** @description 联系人姓名 */
                    contact_person: string;
                    /** @description 地址类型 */
                    type?: string;
                    /** @description 公司中文名 */
                    company_name_cn?: string;
                };
                /** @description 交易单号（例如阿里国际站的信保单ID），注意此字段不为空时，trade_platform字段必填（默认为ICBU） */
                trade_biz_id?: string;
                /** @description 备用字段（上门揽收地址），目前按发货人地址 */
                pickup_address?: {
                    /** @description 国家、省、市、详细地址信息 */
                    address?: {
                        /** @description 邮编 */
                        zip?: string;
                        /** @description 国家 */
                        country?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址名称 */
                            name?: string;
                            /** @description 地址id */
                            area_id?: number;
                        };
                        /** @description 地址 */
                        address?: string;
                        /** @description 乡、镇名称 */
                        town?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址名称 */
                            name?: string;
                            /** @description 地址id */
                            area_id?: number;
                        };
                        /** @description 省份 */
                        province?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址名称 */
                            name?: string;
                            /** @description 地址id */
                            area_id?: number;
                        };
                        /** @description 城市 */
                        city?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址名称 */
                            name?: string;
                            /** @description 地址id */
                            area_id?: number;
                        };
                        /** @description 街道 */
                        district?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址名称 */
                            name?: string;
                        };
                    };
                    /** @description 联系人 */
                    contact_person?: string;
                    /** @description 联系方式(邮箱、电话号码、手机号码等) */
                    contact?: {
                        /** @description 手机号 */
                        mobile_no?: string;
                        /** @description 邮箱 */
                        email?: string;
                        /** @description 电话区号 */
                        phone_code?: string;
                    };
                    /** @description 公司名称 */
                    company_name_cn?: string;
                };
                /** @description 备用字段（退货地址），目前按退货申请指定地址 */
                return_address?: {
                    /** @description 地址信息 */
                    address?: {
                        /** @description 邮编 */
                        zip?: string;
                        /** @description 国家 */
                        country?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址名称 */
                            name?: string;
                            /** @description 地址id */
                            area_id?: number;
                        };
                        /** @description 地址 */
                        address?: string;
                        /** @description 乡、镇名称 */
                        town?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址名称 */
                            name?: string;
                            /** @description 地址id */
                            area_id?: number;
                        };
                        /** @description 省份 */
                        province?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址名称 */
                            name?: string;
                            /** @description 地址id */
                            area_id?: number;
                        };
                        /** @description 城市 */
                        city?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址名称 */
                            name?: string;
                            /** @description 地址id */
                            area_id?: number;
                        };
                        /** @description 街道 */
                        district?: {
                            /** @description 地址代码 */
                            code?: string;
                            /** @description 地址名称 */
                            name?: string;
                        };
                    };
                    /** @description 联系人 */
                    contact_person?: string;
                    /** @description 联系方式(邮箱、电话号码、手机号码等) */
                    contact?: {
                        /** @description 手机号 */
                        mobile_no?: string;
                        /** @description 邮箱地址 */
                        email?: string;
                        /** @description 电话区号 */
                        phone_code?: string;
                    };
                    /** @description 公司名称 */
                    company_name_cn?: string;
                };
                /** @description 跨境电商平台代码：ICBU（阿里巴巴国际站）、ALIEXPRESS（速卖通）、AMAZON（亚马逊）、TIKTOK、TEMU、SHEIN */
                trade_platform?: string;
                /** @description 贸易业务模式（如半托管） */
                trade_biz_mode?: string;
                /** @description 方案信息 */
                solution_dto?: {
                    /** @description 干线线路名称 */
                    trunk_line_name?: string;
                    /** @description 干线线路 skuCode */
                    trunk_line_sku_code?: string;
                    /** @description 揽收类型 */
                    head_pickup_type?: string;
                    /** @description 头程揽收skuId */
                    head_pickup_sku_id?: number;
                    /** @description 头程线路方案id */
                    head_pickup_solution_id?: number;
                    /** @description 头程揽收服务商 */
                    head_pickup_sp_code?: string;
                    /** @description 预计揽收时间 */
                    expect_pickup_time?: number;
                };
            };
        };
        /** alibaba.onetouch.logistics.express.logistics.order.create response */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressLogisticsOrderCreateResponse: {
            /** @description 接口返回model */
            result?: {
                /** @description 返回结果描述 */
                error_message?: string;
                /** @description 结果对象 */
                values?: {
                    /** @description 仓库信息 */
                    warehouse?: {
                        /** @description 仓库地址 */
                        address?: string;
                        /** @description 仓库名称 */
                        name?: string;
                        /** @description 仓库编码 */
                        code?: string;
                        /** @description 联系人 */
                        contact_person?: string;
                        /** @description 联系人电话 */
                        contact_phone?: string;
                        /** @description 工作时间 */
                        working_time?: string;
                        /** @description 邮编 */
                        post_code?: string;
                        /** @description 备注 */
                        description?: string;
                    };
                    /** @description （废弃为空！！面单通过alibaba.onetouch.logistics.express.order.detail.get获取）原条码PDF Base64编码 */
                    bar_code?: string;
                    /** @description 物流订单号 */
                    order_number?: string;
                    /** @description 上门揽收信息 */
                    pickup_info?: {
                        /** @description 备用字段（上门揽收服务商），目前为空 */
                        service_provider?: string;
                        /** @description 上门揽收类型，warehouse_free_pickup：仓库免费上门揽收，warehouse_paid_pickup：仓库收费上门揽收，provider_paid_pickup：服务商收费上门揽收 */
                        pickup_type?: string;
                        /** @description 能否上门揽收 */
                        can_pickup?: boolean;
                        /** @description 上门揽收类型名称 */
                        pickup_type_name?: string;
                    };
                };
                /** @description 是否成功 */
                success?: boolean;
                /** @description 返回结果编码 */
                error_code?: number;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.onetouch.logistics.express.logistics.product.list request */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressLogisticsProductListRequest: Record<string, never>;
        /** alibaba.onetouch.logistics.express.logistics.product.list response */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressLogisticsProductListResponse: {
            /** @description 返回结果 */
            result?: {
                /** @description 错误信息提示 */
                error_message?: string;
                /** @description 列表对象 */
                values?: {
                    /** @description 仓库名称 */
                    warehouse_name?: string;
                    /** @description 仓库编码 */
                    warehouse_code?: string;
                    /** @description 产品名称 */
                    product_name?: string;
                    /** @description 产品编码 */
                    product_code?: string;
                    /** @description 是否上门揽收 */
                    pickup?: boolean;
                    /** @description 时效类型 */
                    delivery_type?: string;
                }[];
                /** @description 是否成功 */
                success?: boolean;
                /** @description 错误码 */
                result_code?: number;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.onetouch.logistics.express.logistics.rule.validate request */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressLogisticsRuleValidateRequest: {
            /** @description 请求参数对象 */
            param_validate: {
                /** @description 单件长区间(cm) */
                length_range?: {
                    /** @description 最小值 */
                    min?: string;
                    /** @description 最大值 */
                    max?: string;
                };
                /** @description 单件体积区间(m3) */
                total_volume_range?: {
                    /** @description 最小值 */
                    min?: string;
                    /** @description 最大值 */
                    max?: string;
                };
                /** @description 包裹区间限制 */
                package_count_range?: {
                    /** @description 最小值 */
                    min?: string;
                    /** @description 最大值 */
                    max?: string;
                };
                /** @description 商品类型列表 */
                product_type?: {
                    /** @description 商品类型code */
                    code?: string;
                    /** @description 商品类型列表 */
                    children?: {
                        /** @description 商品类型code */
                        code?: string;
                        /** @description 商品类型列表 */
                        children?: {
                            /** @description 商品类型code */
                            code?: string;
                            /** @description 商品类型 */
                            name?: string;
                        }[];
                        /** @description 商品类型 */
                        name?: string;
                    }[];
                    /** @description 商品类型 */
                    name?: string;
                }[];
                /** @description 仓库编码 */
                warehouse_code: string;
                /** @description 一票总计费重区间(kg) */
                charge_range?: {
                    /** @description 最小值 */
                    min?: string;
                    /** @description 最大值 */
                    max?: string;
                };
                /** @description 目的地国家列表 */
                destination_countries: {
                    /** @description 国家名称 */
                    name: string;
                    /** @description 国家code */
                    code: string;
                }[];
                /** @description 拒绝承运地址的关键字（json格式字符串，关键字英文逗号分割） */
                forbidden_address?: string;
                /** @description 一票总重区间(kg) */
                total_weight_range?: {
                    /** @description 最小值 */
                    min?: string;
                    /** @description 最大值 */
                    max?: string;
                };
                /** @description 单件体积区间(m3) */
                volume_range?: {
                    /** @description 最小值 */
                    min?: string;
                    /** @description 最大值 */
                    max?: string;
                };
                /** @description 单件长+宽+高区间(cm) */
                lwh_range?: {
                    /** @description 最小值 */
                    min?: string;
                    /** @description 最大值 */
                    max?: string;
                };
                /** @description 单件高区间(cm) */
                height_range?: {
                    /** @description 最小值 */
                    min?: string;
                    /** @description 最大值 */
                    max?: string;
                };
                /** @description 单件宽区间(cm) */
                width_range?: {
                    /** @description 最小值 */
                    min?: string;
                    /** @description 最大值 */
                    max?: string;
                };
                /** @description 产品编码 */
                product_code: string;
                /** @description 单件围长区间(cm) */
                girth_range?: {
                    /** @description 最小值 */
                    min?: string;
                    /** @description 最大值 */
                    max?: string;
                };
                /** @description 单件重量区间(kg) */
                weight_range?: {
                    /** @description 最小值 */
                    min?: string;
                    /** @description 最大值 */
                    max?: string;
                };
            };
        };
        /** alibaba.onetouch.logistics.express.logistics.rule.validate response */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressLogisticsRuleValidateResponse: {
            /** @description 返回结果 */
            result?: {
                /** @description 错误信息提示 */
                error_message?: string;
                /** @description 校验结果 */
                values?: boolean;
                /** @description 是否成功 */
                success?: boolean;
                /** @description 错误码 */
                error_code?: number;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.onetouch.logistics.express.order.cancel.reason.list request */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressOrderCancelReasonListRequest: Record<string, never>;
        /** alibaba.onetouch.logistics.express.order.cancel.reason.list response */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressOrderCancelReasonListResponse: {
            /** @description 接口返回model */
            result?: {
                /** @description 错误信息提示 */
                error_message?: string;
                /** @description 列表对象 */
                values?: {
                    /** @description 异常描述 */
                    value?: string;
                    /** @description 异常key */
                    key?: string;
                }[];
                /** @description 是否成功 */
                success?: boolean;
                /** @description 错误码 */
                error_code?: number;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.onetouch.logistics.express.order.cancel request */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressOrderCancelRequest: {
            /** @description 系统自动生成 */
            param_operate?: {
                /** @description 取消原因列表 */
                reason_list: string[];
                /** @description 物流单号 */
                order_number: string;
            };
        };
        /** alibaba.onetouch.logistics.express.order.cancel response */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressOrderCancelResponse: {
            /** @description 返回结果 */
            result?: {
                /** @description 错误信息提示 */
                error_message?: string;
                /** @description 取消结果 */
                values?: boolean;
                /** @description 是否成功 */
                success?: boolean;
                /** @description 错误码 */
                error_code?: number;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.onetouch.logistics.express.order.detail.get request */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressOrderDetailGetRequest: {
            /** @description 请求参数 */
            param_query: {
                /** @description 物流单号 */
                order_number: string;
            };
        };
        /** alibaba.onetouch.logistics.express.order.detail.get response */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressOrderDetailGetResponse: {
            /** @description 接口返回model */
            result?: {
                /** @description 返回结果编码 */
                error_code?: number;
                /** @description 是否成功 */
                success?: boolean;
                /** @description 结果数据 */
                data?: {
                    /** @description 仓库信息 */
                    warehouse?: {
                        /** @description 备注 */
                        description?: string;
                        /** @description 工作时间 */
                        working_time?: string;
                        /** @description 联系电话 */
                        contact_phone?: string;
                        /** @description 联系人 */
                        contact_person?: string;
                        /** @description 地址 */
                        address?: string;
                        /** @description 仓库名称 */
                        name?: string;
                        /** @description 仓库编码 */
                        code?: string;
                    };
                    /** @description 条码Base64 */
                    bar_code?: string;
                    /** @description 物流订单号 */
                    order_number?: string;
                    /** @description 上门揽收信息 */
                    pickup_info?: {
                        /** @description 能否上门揽收 */
                        can_pickup?: boolean;
                        /** @description 上门揽收类型，warehouse_free_pickup：仓库免费上门揽收，warehouse_paid_pickup：仓库收费上门揽收，provider_paid_pickup：服务商收费上门揽收 */
                        pickup_type?: string;
                        /** @description 上门揽收类型名称 */
                        pickup_type_name?: string;
                        /** @description 上门揽收服务商 */
                        service_provider?: string;
                    };
                };
                /** @description 返回结果描述 */
                error_message?: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.onetouch.logistics.express.order.list.query request */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressOrderListQueryRequest: {
            /** @description 请求参数 */
            param_query?: {
                /** @description 页面数据大小 */
                page_size: number;
                /** @description 当前页 */
                current_page: number;
                /** @description 物流订单号 */
                order_number?: string;
            };
        };
        /** alibaba.onetouch.logistics.express.order.list.query response */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressOrderListQueryResponse: {
            /** @description 结果 */
            result?: {
                /** @description 异常信息 */
                msg?: string;
                /** @description 数据 */
                data?: {
                    /** @description 总数 */
                    total?: number;
                    /** @description 总页数 */
                    total_page?: number;
                    /** @description 订单数据 */
                    data_list?: {
                        /** @description 下单时间 */
                        place_order_time?: number | string;
                        /** @description 订单号 */
                        order_number?: string;
                        /** @description 运费金额 */
                        freight_amount?: string;
                        /** @description 交易单号 */
                        trade_biz_id?: string;
                        /** @description 运费币种 */
                        freight_currency?: string;
                        /** @description 目的国编码 */
                        destination_country_code?: string;
                        /** @description 订单状态 */
                        order_status?: string;
                        /** @description 详情链接 */
                        detail_url?: string;
                        /** @description 物流类型 */
                        logistics_type?: string;
                    }[];
                    /** @description 每页数据大小 */
                    page_size?: number;
                    /** @description 当前页 */
                    current_page?: number;
                };
                /** @description 是否成功 */
                success?: boolean;
                /** @description 异常码 */
                result_code?: number;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.onetouch.logistics.express.special.product.type.list request */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressSpecialProductTypeListRequest: Record<string, never>;
        /** alibaba.onetouch.logistics.express.special.product.type.list response */
        AlibabaLogisticsAlibabaOnetouchLogisticsExpressSpecialProductTypeListResponse: {
            /** @description 接口返回model */
            result?: {
                /** @description 返回结果描述 */
                error_message?: string;
                /** @description 列表对象 */
                values?: {
                    /** @description 商品类型code */
                    code?: string;
                    /** @description 商品类型 */
                    name?: string;
                    /** @description 列表对象 */
                    childrens?: {
                        /** @description 商品类型code */
                        code?: string;
                        /** @description 商品类型 */
                        name?: string;
                        /** @description 列表对象 */
                        childrens?: {
                            /** @description 商品类型code */
                            code?: string;
                            /** @description 商品类型 */
                            name?: string;
                        }[];
                    }[];
                }[];
                /** @description 是否成功 */
                success?: boolean;
                /** @description 返回结果编码 */
                error_code?: number;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.wholesale.shippingline.template.list request */
        AlibabaLogisticsAlibabaWholesaleShippinglineTemplateListRequest: {
            /** @description 第几页从1开始 */
            page_num?: number;
            /** @description 每页返回的数据个数 */
            count?: number;
        };
        /** alibaba.wholesale.shippingline.template.list response */
        AlibabaLogisticsAlibabaWholesaleShippinglineTemplateListResponse: {
            /** @description 运费模板列表 */
            list_template_response?: {
                /** @description 运费模板总数 */
                total?: number;
                /** @description 运费模板集合 */
                items?: {
                    /** @description 运费模板id */
                    id?: number;
                    /** @description 运费模板名称 */
                    title?: string;
                }[];
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.photobank.group.list request */
        AlibabaPhotoAlibabaIcbuPhotobankGroupListRequest: {
            /** @description 补充信息 */
            extra_context?: {
                [key: string]: unknown;
            };
            /** @description 查询图片分组信息，如果传入id，则获取当前分组和所有子分组信息，否则获取所有一级分组信息 */
            id?: number;
        };
        /** alibaba.icbu.photobank.group.list response */
        AlibabaPhotoAlibabaIcbuPhotobankGroupListResponse: {
            /** @description 图库分组；真实账号响应直接返回数组 */
            groups?: {
                /** @description 分组 ID */
                id: number;
                /** @description 一级分组 ID */
                level1?: number;
                /** @description 二级分组 ID */
                level2?: number;
                /** @description 三级分组 ID */
                level3?: number;
                /** @description 分组名称 */
                name: string;
            }[];
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.photobank.group.operate request */
        AlibabaPhotoAlibabaIcbuPhotobankGroupOperateRequest: {
            /** @description 图片分组操作请求对象 */
            photo_group_operation_request?: {
                /** @description add操作中表示新增的分组名，rename操作中表示重命名后的分组名，delete操作不填 */
                group_name?: string;
                /** @description add操作中表示新增分组的父分组id，delete操作和rename操作表示要操作的分组id */
                group_id?: number;
                /** @description add表示新增分组，delete表示删除分组，rename表示重命名分组 */
                operation?: string;
            };
        };
        /** alibaba.icbu.photobank.group.operate response */
        AlibabaPhotoAlibabaIcbuPhotobankGroupOperateResponse: {
            /** @description 接口返回的数据结果 */
            photo_group_result?: {
                /** @description add操作中表示新增的图片分组，rename操作中表示重命名的分组，delete操作中返回分组信息 */
                photobank_group?: {
                    /** @description level3 */
                    level3?: number;
                    /** @description level2 */
                    level2?: number;
                    /** @description level1 */
                    level1?: number;
                    /** @description 分组名字 */
                    name?: string;
                    /** @description 分组id */
                    id?: number;
                };
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.photobank.list request */
        AlibabaPhotoAlibabaIcbuPhotobankListRequest: {
            /** @description 额外的上下文信息. 例如:icvId */
            extra_context?: {
                [key: string]: unknown;
            };
            /** @description 当前翻页数 */
            current_page?: number;
            /** @description 图片组id */
            group_id?: string;
            /** @description 存放位置 必要条件, 包括ALL_GROUP(所有目录), SUB_GROUP(指定图片组下),UNGROUP(未分组), TEMP(disable)四个值 */
            location_type?: string;
            /** @description 每页显示数 */
            page_size?: number;
        };
        /** alibaba.icbu.photobank.list response */
        AlibabaPhotoAlibabaIcbuPhotobankListResponse: {
            /** @description traceId */
            trace_id?: string;
            /** @description PaginationQueryList */
            pagination_query_list?: {
                /** @description image_list */
                list?: {
                    /** @description 图片url */
                    url?: string;
                    /** @description 图片id */
                    id?: string;
                    /** @description 文件名字 */
                    file_name?: string;
                    /** @description 修改时间 */
                    gmt_modified?: number | string;
                    /** @description 归属人 */
                    owner_member_display_name?: string;
                    /** @description 文件大小 */
                    file_size?: number;
                    /** @description 图片引用数量 */
                    reference_count?: number;
                    /** @description 分组id */
                    group_id?: number;
                    /** @description 展示名字 */
                    display_name?: string;
                }[];
                total?: number;
            };
            /** @description error code */
            errorcode?: string;
            /** @description error message */
            errormsg?: string;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.photobank.upload request */
        AlibabaPhotoAlibabaIcbuPhotobankUploadRequest: {
            /** @description 扩展参数信息,如ICVID */
            extra_context?: {
                [key: string]: unknown;
            };
            /** @description 上传图片名称 */
            file_name: string;
            /** @description 上传图片所在分组 */
            group_id?: string;
            /** @description 图片字节数组 */
            image_bytes: string;
        };
        /** alibaba.icbu.photobank.upload response */
        AlibabaPhotoAlibabaIcbuPhotobankUploadResponse: {
            /** @description 图片信息 */
            upload_image_response?: {
                /** @description 生成的图片名称 */
                file_name?: string;
                /** @description 生成的图片全路径URL */
                photobank_url?: string;
                /** @description 图片的唯一识别id */
                file_id?: number;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.file.urlposting.upload request */
        AlibabaPlatformAlibabaIcbuFileUrlpostingUploadRequest: {
            /** @description 调用方 */
            caller: string;
            /** @description 文件名称 */
            file_name: string;
            /** @description 文件URL */
            url?: string;
            /** @description 文件流 */
            file_stream: string;
        };
        /** alibaba.icbu.file.urlposting.upload response */
        AlibabaPlatformAlibabaIcbuFileUrlpostingUploadResponse: {
            /** @description 调用结果 */
            result?: string;
            /** @description 失败原因 */
            fail_reason?: string;
            /** @description 上传后的文件链接 */
            file_url?: string;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.risk.send request */
        AlibabaPlatformAlibabaIcbuRiskSendRequest: {
            /** @description 风控请求参数 */
            event_data: {
                /** @description 风险事件Code */
                event_code: string;
                /** @description 风险附加参数 */
                extend: string;
                /** @description 业务对象标识 */
                event_item_id: string;
                /** @description 异步结果回调标识 */
                callback_id: string;
                /** @description 业务对象名称 */
                event_item: string;
                /** @description 请求相关环境信息 */
                env_info?: {
                    /** @description 通过无线保镖采集的无线wua信息 */
                    wua?: string;
                    /** @description 采集用户的umidtoken */
                    umid?: string;
                    /** @description 采集用户的ip */
                    ip?: string;
                    /** @description 硬件设备码 */
                    imei?: string;
                    /** @description 运营商设备码 */
                    imsi?: string;
                    /** @description 通过collina采集的ua信息 */
                    ua?: string;
                    /** @description 设备mac地址 */
                    mac?: string;
                };
                /** @description 数据时间戳 */
                event_time: number;
            };
        };
        /** alibaba.icbu.risk.send response */
        AlibabaPlatformAlibabaIcbuRiskSendResponse: {
            /** @description 返回结果Code（100-Pass，200-Reject，300-Pending） */
            result_code?: number;
            /** @description 返回结果附加信息 */
            data?: {
                /** @description 拒绝原因列表 */
                reject_items?: {
                    /** @description 拒绝原因 */
                    reject_reason?: string;
                    /** @description 风险分类 */
                    risk_type?: string;
                }[];
                /** @description 暂缓原因列表 */
                pending_items?: {
                    /** @description 暂缓原因 */
                    reject_reason?: string;
                    /** @description 风险分类 */
                    risk_type?: string;
                }[];
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.task.status.notify request */
        AlibabaPlatformAlibabaIcbuTaskStatusNotifyRequest: {
            /** @description 含税三方计费 */
            deduction?: string;
            /** @description 不含税三方计费 */
            no_tax_deduction?: string;
            /** @description 任务key */
            task_key: string;
            /** @description 任务失败原因 */
            fail_reason?: string;
            /** @description 供应商 */
            isv: string;
            /** @description 任务状态 */
            task_status: string;
            /** @description 商品基本详情爬取任务 */
            type?: string;
            /** @description 分页ID */
            page_id?: string;
            /** @description 当前已处理的总商品数量 */
            handled_prod_nums?: number;
        };
        /** alibaba.icbu.task.status.notify response */
        AlibabaPlatformAlibabaIcbuTaskStatusNotifyResponse: {
            /** @description 调用结果 */
            result?: string;
            /** @description 通知失败原因 */
            fail_reason?: string;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.category.attr.get request */
        AlibabaProductAlibabaIcbuCategoryAttrGetRequest: {
            /** @description 类目属性request对象 */
            attribute_request?: {
                /** @description 属性id列表，若填写，只返回给定属性id信息 */
                attr_id?: string[];
                /** @description 必填；发布类目id */
                cat_id?: number;
            };
        };
        /** alibaba.icbu.category.attr.get response */
        AlibabaProductAlibabaIcbuCategoryAttrGetResponse: {
            /** @description 属性返回结果 */
            result_list?: {
                /** @description 属性id */
                attr_id?: number;
                /** @description 所属发布类目id */
                catid?: number;
                /** @description 中文名字 */
                cn_name?: string;
                /** @description 英文名字 */
                en_name?: string;
                /** @description 是否是关键属性 */
                key_attr?: boolean;
                /** @description 是否是定位属性； */
                locator?: boolean;
                /** @description 属性在该发布类目下的顺序 */
                order?: number;
                /** @description 如果是该类目下某个属性值的子属性，这里为该属性值id */
                parent_value?: number;
                /** @description 是否必填属性 */
                required?: boolean;
                /** @description 展示类型；input；group */
                show_type?: string;
                /** @description 该属性的单位 */
                units?: string[];
            }[];
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.category.attribute.get request */
        AlibabaProductAlibabaIcbuCategoryAttributeGetRequest: {
            /** @description 发布类目id */
            cat_id: number;
        };
        /** alibaba.icbu.category.attribute.get response */
        AlibabaProductAlibabaIcbuCategoryAttributeGetResponse: {
            /** @description 类目下的属性和属性值信息 */
            attributes?: {
                /** @description 属性id */
                attr_id?: number;
                /** @description 属性可选的属性值 */
                attribute_values?: {
                    /** @description 属性值id */
                    attr_value_id?: number;
                    /** @description 该属性值的子属性id */
                    child_attrs?: string[];
                    /** @description 英文名字 */
                    en_name?: string;
                    /** @description 是否SKU属性值 */
                    sku_value?: boolean;
                }[];
                /** @description 用成SKU属性时，是否支持自定义图片展示 */
                customize_image?: boolean;
                /** @description 用成SKU属性时，是否支持自定义属性值名称 */
                customize_value?: boolean;
                /** @description 英文名字 */
                en_name?: string;
                /** @description 输入类型 */
                input_type?: string;
                /** @description 是否必填属性 */
                required?: boolean;
                /** @description 展示类型 */
                show_type?: string;
                /** @description 该属性能否当成SKU属性 */
                sku_attribute?: boolean;
                /** @description 该属性的单位 */
                units?: string[];
                /** @description valueType */
                value_type?: string;
                /** @description 表示是否车型库属性，如果是，则需要从分层属性接口里获取下一级属性 */
                car_model?: boolean;
            }[];
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.category.attrvalue.get request */
        AlibabaProductAlibabaIcbuCategoryAttrvalueGetRequest: {
            /** @description 属性值request对象 */
            attribute_value_request?: {
                /** @description 选填；需要过滤的属性值id */
                attribute_value_id?: number[];
                /** @description 必填；要查询的属性值所属发布类目 */
                cat_id: number;
                /** @description 选填；需要过滤的属性 */
                attribute_id?: number[];
            };
        };
        /** alibaba.icbu.category.attrvalue.get response */
        AlibabaProductAlibabaIcbuCategoryAttrvalueGetResponse: {
            /** @description 返回值 */
            result_list?: {
                /** @description 属性id */
                attr_id?: number;
                /** @description 英文名字 */
                en_name?: string;
                /** @description 属性值id */
                attr_value_id?: number;
                /** @description 该属性值的子属性id */
                child_attrs?: number[];
                /** @description 所属类目id */
                cat_id?: number;
            }[];
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.category.get.new request */
        AlibabaProductAlibabaIcbuCategoryGetNewRequest: {
            /** @description 发布类目id,必须大于等于0， 如果为0，则查询所有一级类目 */
            cat_id: number;
        };
        /** alibaba.icbu.category.get.new response */
        AlibabaProductAlibabaIcbuCategoryGetNewResponse: {
            /** @description 类目信息 */
            category?: {
                /** @description 类目ID */
                category_id?: number;
                /** @description 子类目ID数组 */
                child_ids?: (number | string)[];
                /** @description 是否叶子类目（只有叶子类目才能发布商品） */
                leaf_category?: boolean;
                /** @description 类目层级 */
                level?: number;
                /** @description 类目名称 */
                name?: string;
                /** @description 父类目ID数组 */
                parent_ids?: (number | string)[];
                /** @description 类目的中文名 */
                cn_name?: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.category.get request */
        AlibabaProductAlibabaIcbuCategoryGetRequest: {
            /** @description 发布类目id,必须大于等于0， 如果为0，则查询所有一级类目 */
            cat_id: number;
        };
        /** alibaba.icbu.category.get response */
        AlibabaProductAlibabaIcbuCategoryGetResponse: {
            /** @description 类目信息 */
            category?: {
                /** @description 父类目ID数组 */
                parent_ids?: number[];
                /** @description 类目层级 */
                level?: number;
                /** @description 是否叶子类目（只有叶子类目才能发布商品） */
                leaf_category?: boolean;
                /** @description 类目名称 */
                name?: string;
                /** @description 类目ID */
                category_id?: number;
                /** @description 子类目ID数组 */
                child_ids?: number[];
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.category.id.mapping request */
        AlibabaProductAlibabaIcbuCategoryIdMappingRequest: {
            /** @description 发布类目id */
            cat_id: number;
            /** @description 属性值id */
            attribute_value_id?: number;
            /** @description 属性id */
            attribute_id?: number;
            /** @description 转化类型, 1 = 转化类目id 2= 转化属性id 3= 转化属性值id */
            convert_type?: number;
        };
        /** alibaba.icbu.category.id.mapping response */
        AlibabaProductAlibabaIcbuCategoryIdMappingResponse: {
            /** @description 转化的类目id */
            mapping_result?: number;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.category.level.attr.get request */
        AlibabaProductAlibabaIcbuCategoryLevelAttrGetRequest: {
            /** @description 属性值request对象 */
            attribute_value_request?: {
                /** @description 类目属性id，放到数组第一个位置 */
                attr_id?: string[];
                /** @description 属性值id, 不同取值范围时的查询策略如下:  <=0：列出当前类目属性的所有属性值  >0：指定当前类目属性的某一个属性值，列出该属性值下的子属性和该子属性的所有属性值 */
                value_id?: number;
                /** @description 必填；要查询的属性值所属发布类目 */
                cat_id: number;
            };
        };
        /** alibaba.icbu.category.level.attr.get response */
        AlibabaProductAlibabaIcbuCategoryLevelAttrGetResponse: {
            /** @description 返回值 */
            result_list?: {
                /** @description List<Map<String,Object>>  列表中每个元素的key-value说明如下:  id: 值id  name：值名称  leaf: 此key存在且为true代表当前节点下已无下层属性,这种情况下前端不需再在当前节点上提供弹出下级菜单之类的操作 */
                values?: string;
                /** @description propertyId对应的属性中文名 */
                property_cn_name?: string;
                /** @description propertyId对应的属性英文名 */
                property_en_name?: string;
                /** @description 返回值所在的属性id，如入参valueId为0，则与入参的attrId一致，否则为所选属性值的下层属性id */
                property_id?: number;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.category.postcat.get request */
        AlibabaProductAlibabaIcbuCategoryPostcatGetRequest: {
            /** @description 发布类目查询request */
            post_cat_request?: {
                /** @description 发布类目id,必须大于等于0， 如果为0，则查询所有一级类目 */
                cat_id: number;
            };
        };
        /** alibaba.icbu.category.postcat.get response */
        AlibabaProductAlibabaIcbuCategoryPostcatGetResponse: {
            /** @description 发布类目返回数据 */
            result_list?: {
                /** @description 父亲类目；如果为0，则代表该类目为一级类目 */
                parent_ids?: number[];
                /** @description 英文名字 */
                en_name?: string;
                /** @description 中文名字 */
                cn_name?: string;
                /** @description 是否是叶子类目 */
                leaf_cat?: boolean;
                /** @description 类目id */
                cat_id?: number;
                /** @description 孩子类目；如果为叶子，则为空 */
                child_ids?: number[];
            }[];
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.category.schema.level.get request */
        AlibabaProductAlibabaIcbuCategorySchemaLevelGetRequest: {
            /** @description 类目id */
            cat_id?: number;
            /** @description 返回的文案的语种，可以输入en_US或者zh */
            language?: string;
            /** @description 层级属性的当前层级属性 */
            xml?: string;
        };
        /** alibaba.icbu.category.schema.level.get response */
        AlibabaProductAlibabaIcbuCategorySchemaLevelGetResponse: {
            /** @description Top返回对象 */
            result?: {
                /** @description 层级属性的下一级属性结构 */
                data?: string;
                /** @description 错误信息 */
                message?: string;
                /** @description 错误码 */
                msg_code?: string;
                /** @description 是否成功 */
                biz_success?: boolean;
                /** @description 用于排查系统错误 */
                trace_id?: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.open.product.post request */
        AlibabaProductAlibabaIcbuOpenProductPostRequest: {
            /** @description product input param */
            param_product_post: {
                /** @description 产品组ID */
                group_id?: number;
                /** @description 关键字 */
                keywords: string[];
                /** @description 产品主题 */
                subject: string;
                /** @description 产品描述 */
                description?: string;
                /** @description 类目ID */
                category_id: number;
                /** @description 商品交易信息对象 */
                product_trade?: {
                    /** @description 金额类型，枚举值 */
                    money_type?: number;
                    /** @description FOB价格 最小值 */
                    price_range_min?: string;
                    /** @description FOB价格 最大值 */
                    price_range_max?: string;
                    /** @description FOB价格 计量单位，枚举值 */
                    price_unit?: number;
                    /** @description 最小起订量数量 */
                    min_order_quantity?: string;
                    /** @description 最小起订量计量单位，枚举值 */
                    min_order_unit?: number;
                    /** @description 付款方式，枚举值 */
                    payment_methods?: string[];
                    /** @description 港口 */
                    port?: string;
                    /** @description 供货能力 */
                    supply_quantity?: string;
                    /** @description 计量单位，枚举值 */
                    supply_unit?: number;
                    /** @description 供应周期 */
                    supply_period?: string;
                    /** @description 发货期限 */
                    consignment_term?: string;
                    /** @description 常规包装 */
                    packaging_desc?: string;
                };
                /** @description 商品图片对象 */
                product_image: {
                    /** @description 主图图片信息列表 */
                    image_file_list?: {
                        /** @description 图片URL信息 */
                        image_file_url?: string;
                    }[];
                    /** @description 图片是否有水印 */
                    image_watermark?: boolean;
                };
                /** @description 商品属性对象 */
                properties?: string[];
                /** @description 产品ID */
                product_id?: number;
                /** @description 扩展信息, 如ICVID */
                extra_context?: {
                    [key: string]: unknown;
                };
            };
        };
        /** alibaba.icbu.open.product.post response */
        AlibabaProductAlibabaIcbuOpenProductPostResponse: {
            /** @description 产品ID */
            product_id?: number;
            /** @description 加密后的产品id */
            str_product_id?: string;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.product.add.draft request */
        AlibabaProductAlibabaIcbuProductAddDraftRequest: {
            /** @description 商品属性和属性值 */
            attributes?: {
                /** @description 属性ID */
                attribute_id?: number;
                /** @description 属性名称 */
                attribute_name?: string;
                /** @description 属性值ID */
                value_id?: number;
                /** @description 属性值名称 */
                value_name?: string;
                /** @description 作为sku属性值时，自定义属性值名称 */
                sku_custom_value_name?: string;
                /** @description 作为sku属性值时，用图形来展示；必须是alibaba图片中心的图片URL，请使用API alibaba.icbu.photobank.upload 上传图片 */
                sku_custom_image_url?: string;
            }[];
            /** @description 根据数量设置的折扣价 */
            bulk_discount_prices?: {
                /** @description 起始数量，范围是1-99999 */
                start_quantity?: number;
                /** @description 价格，范围是0.01-9999999.00 */
                price?: string;
            }[];
            /** @description 类目ID */
            category_id: number;
            /** @description 商品详情描述，可包含图片中心的图片URL */
            description?: string;
            /** @description 补充信息 */
            extra_context?: {
                [key: string]: unknown;
            };
            /** @description 分组ID */
            group_id?: number;
            /** @description 关键词，不要包含特殊符号（如,;），最多三个 */
            keywords?: string[];
            /** @description 语种，参见FAQ 语种枚举值 */
            language: string;
            /** @description 商品主图 */
            main_image?: {
                /** @description alibaba图片中心的图片URL列表，请使用alibaba.icbu.photobank.upload接口上传图片 */
                images?: string[];
                /** @description 是否打水印，是(true)或否(false) */
                watermark?: boolean;
                /** @description 水印是否有边框，有边框(Y)或者无边框(N) */
                watermark_frame?: string;
                /** @description 水印位置，在中间(center)或者在底部(bottom) */
                watermark_position?: string;
            };
            /** @description 商品SKU定义 */
            product_sku?: {
                /** @description 商品属性 */
                attributes?: {
                    /** @description 属性ID */
                    attribute_id?: number;
                    /** @description 属性名称 */
                    attribute_name?: string;
                    /** @description 属性值ID，自定义属性值时ID要小于0，并且不能重复 */
                    value_id?: number;
                    /** @description 属性值名称 */
                    value_name?: string;
                    /** @description 作为sku属性值时，用图形来展示；必须是alibaba图片中心的图片URL，请使用API alibaba.icbu.photobank.upload 上传图片 */
                    sku_custom_image_url?: string;
                    /** @description 作为sku属性值时，自定义属性值名称 */
                    sku_custom_value_name?: string;
                }[];
                /** @description 单个SKU详细定义 */
                special_skus?: {
                    /** @description 商品属性 */
                    attributes?: {
                        /** @description 属性ID */
                        attribute_id?: number;
                        /** @description 属性名称 */
                        attribute_name?: string;
                        /** @description 属性值ID，自定义属性值时ID要小于0，并且不能重复 */
                        value_id?: number;
                        /** @description 属性值名称 */
                        value_name?: string;
                        /** @description 作为sku属性值时，用图形来展示；必须是alibaba图片中心的图片URL，请使用API alibaba.icbu.photobank.upload 上传图片 */
                        sku_custom_image_url?: string;
                        /** @description 作为sku属性值时，自定义属性值名称 */
                        sku_custom_value_name?: string;
                    }[];
                    /** @description 价格，单位是美元，精确到小数点后两位，范围是0.01-9999999.00 */
                    price?: string;
                    /** @description 商品的SKU编码 */
                    sku_code?: string;
                    /** @description 库存 */
                    inventory_dto_list?: {
                        /** @description 仓库code，默认不填 */
                        store_code?: string;
                        /** @description 想设置的库存 */
                        current_inventory?: number;
                        /** @description 原始库存 */
                        src_inventory?: number;
                    }[];
                }[];
                /** @description 需要失效的SKU的详细定义 */
                exclude_skus?: {
                    /** @description 商品属性 */
                    attributes?: {
                        /** @description 属性ID */
                        attribute_id?: number;
                        /** @description 属性名称 */
                        attribute_name?: string;
                        /** @description 属性值ID，自定义属性值时ID要小于0，并且不能重复 */
                        value_id?: number;
                        /** @description 属性值名称 */
                        value_name?: string;
                        /** @description 作为sku属性值时，用图形来展示；必须是alibaba图片中心的图片URL，请使用API alibaba.icbu.photobank.upload 上传图片 */
                        sku_custom_image_url?: string;
                        /** @description 作为sku属性值时，自定义属性值名称 */
                        sku_custom_value_name?: string;
                    }[];
                    /** @description 价格，单位是美元，精确到小数点后两位，范围是0.01-9999999.00 */
                    price?: string;
                }[];
            };
            /** @description 商品类型，在线批发商品(wholesale)或者询盘商品(sourcing)，值为wholesale时，必须填写wholesale_trade */
            product_type: string;
            /** @description 询盘商品交易信息 */
            sourcing_trade?: {
                /** @description FOB货币价格，枚举值 */
                fob_currency?: string;
                /** @description FOB最小价格 */
                fob_min_price?: string;
                /** @description FOB最大价格 */
                fob_max_price?: string;
                /** @description FOB计量单位，枚举值 */
                fob_unit_type?: string;
                /** @description 付款方式，枚举值 */
                payment_methods?: string[];
                /** @description 最小起订量 */
                min_order_quantity?: string;
                /** @description 最小起订量计量单位，枚举值 */
                min_order_unit_type?: string;
                /** @description 供货能力 */
                supply_quantity?: string;
                /** @description 供货能力计量单位，枚举值 */
                supply_unit_type?: string;
                /** @description 供货能力周期，枚举值 */
                supply_period_type?: string;
                /** @description 发货港口 */
                delivery_port?: string;
                /** @description 发货期限 */
                delivery_time?: string;
                /** @description 包装信息 */
                packaging_desc?: string;
                /** @description 发货周期，发货时间相关建议使用此项 */
                deliver_periods?: {
                    /** @description 预计需要发货时间 */
                    process_period?: number;
                    /** @description 数量 */
                    quantity?: number;
                }[];
            };
            /** @description 商品名称，最多128个字符 */
            subject?: string;
            /** @description 在线批发商品交易信息 */
            wholesale_trade?: {
                /** @description 最小计量单位，枚举值 */
                unit_type?: string;
                /** @description 销售方式，按件卖(normal)或者按批卖(batch) */
                sale_type?: string;
                /** @description 每批数量，当sale_type=batch时生效，范围是1-99999 */
                batch_number?: number;
                /** @description 价格，单位是美元，精确到小数点后两位，范围是0.01-9999999.00 */
                price?: string;
                /** @description 尺寸，单位是厘米，长宽高范围是1-9999999 */
                package_size?: string;
                /** @description 重量，单位是kg，精确到小数点后三位，范围是0.01-9999999.000 */
                weight?: string;
                /** @description 最小起订量，范围是1-99999 */
                min_order_quantity?: number;
                /** @description 运费模板ID */
                shipping_line_template_id?: number;
                /** @description 备货期，单位是天，范围是1-60 */
                handling_time?: number;
                /** @description 发货周期，发货时间相关建议使用此项 */
                deliver_periods?: {
                    /** @description 预计需要发货时间 */
                    process_period?: number;
                    /** @description 数量 */
                    quantity?: number;
                }[];
            };
            /** @description 发布的市场，支持main/onesite，默认main发到主市场，填onesite发布为商机通产品 */
            market?: string;
            /** @description 是否智能编辑，如果不传，默认为false */
            is_smart_edit?: boolean;
            /** @description 定制信息 */
            custom_info?: {
                /** @description 定制内容 */
                custom_contents?: {
                    /** @description 最小起订量 */
                    min_order_quantity?: number;
                    /** @description 定制类型，只允许填写英文字符 */
                    custom_type?: string;
                }[];
            };
        };
        /** alibaba.icbu.product.add.draft response */
        AlibabaProductAlibabaIcbuProductAddDraftResponse: {
            /** @description 混淆后的产品ID */
            product_id?: string;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.product.add request */
        AlibabaProductAlibabaIcbuProductAddRequest: {
            /** @description 商品属性和属性值 */
            attributes?: {
                /** @description 属性ID */
                attribute_id?: number;
                /** @description 属性名称 */
                attribute_name?: string;
                /** @description 属性值ID */
                value_id?: number;
                /** @description 属性值名称 */
                value_name?: string;
                /** @description 作为sku属性值时，自定义属性值名称 */
                sku_custom_value_name?: string;
                /** @description 作为sku属性值时，用图形来展示；必须是alibaba图片中心的图片URL，请使用API alibaba.icbu.photobank.upload 上传图片 */
                sku_custom_image_url?: string;
            }[];
            /** @description 根据数量设置的折扣价 */
            bulk_discount_prices?: {
                /** @description 价格，范围是0.01-9999999.00 */
                price?: string;
                /** @description 起始数量，范围是1-99999 */
                start_quantity?: number;
            }[];
            /** @description 类目ID */
            category_id: number;
            /** @description 商品详情描述，可包含图片中心的图片URL */
            description?: string;
            /** @description 补充信息 */
            extra_context?: {
                [key: string]: unknown;
            };
            /** @description 分组ID */
            group_id?: number;
            /** @description 关键词，不要包含特殊符号（如,;），最多三个 */
            keywords: string[];
            /** @description 语种，参见FAQ 语种枚举值 */
            language: string;
            /** @description 商品主图 */
            main_image: {
                /** @description alibaba图片中心的图片URL列表，请使用alibaba.icbu.photobank.upload接口上传图片 */
                images: string[];
                /** @description 是否打水印，是(true)或否(false) */
                watermark?: boolean;
                /** @description 水印是否有边框，有边框(Y)或者无边框(N) */
                watermark_frame?: string;
                /** @description 水印位置，在中间(center)或者在底部(bottom) */
                watermark_position?: string;
            };
            /** @description 商品SKU定义 */
            product_sku?: {
                /** @description 商品属性 */
                attributes?: {
                    /** @description 属性ID */
                    attribute_id?: number;
                    /** @description 作为sku属性值时，用图形来展示；必须是alibaba图片中心的图片URL，请使用API alibaba.icbu.photobank.upload 上传图片 */
                    sku_custom_image_url?: string;
                    /** @description 作为sku属性值时，自定义属性值名称 */
                    sku_custom_value_name?: string;
                    /** @description 属性值ID，自定义属性值时ID要小于0，并且不能重复 */
                    value_id?: number;
                    /** @description 属性名称 */
                    attribute_name?: string;
                    /** @description 属性值名称 */
                    value_name?: string;
                }[];
                /** @description 需要失效的SKU的详细定义 */
                exclude_skus?: {
                    /** @description 商品属性 */
                    attributes?: {
                        /** @description 属性ID */
                        attribute_id?: number;
                        /** @description 属性值ID，自定义属性值时ID要小于0，并且不能重复 */
                        value_id?: number;
                        /** @description 属性值名称 */
                        value_name?: string;
                        /** @description 属性名称 */
                        attribute_name?: string;
                        /** @description 作为sku属性值时，自定义属性值名称 */
                        sku_custom_value_name?: string;
                        /** @description 作为sku属性值时，用图形来展示；必须是alibaba图片中心的图片URL，请使用API alibaba.icbu.photobank.upload 上传图片 */
                        sku_custom_image_url?: string;
                    }[];
                    /** @description 价格，单位是美元，精确到小数点后两位，范围是0.01-9999999.00 */
                    price?: string;
                }[];
                /** @description 单个SKU详细定义 */
                special_skus?: {
                    /** @description 商品属性 */
                    attributes?: {
                        /** @description 属性ID */
                        attribute_id?: number;
                        /** @description 属性值ID，自定义属性值时ID要小于0，并且不能重复 */
                        value_id?: number;
                        /** @description 属性值名称 */
                        value_name?: string;
                        /** @description 属性名称 */
                        attribute_name?: string;
                        /** @description 作为sku属性值时，自定义属性值名称 */
                        sku_custom_value_name?: string;
                        /** @description 作为sku属性值时，用图形来展示；必须是alibaba图片中心的图片URL，请使用API alibaba.icbu.photobank.upload 上传图片 */
                        sku_custom_image_url?: string;
                    }[];
                    /** @description 价格，单位是美元，精确到小数点后两位，范围是0.01-9999999.00 */
                    price?: string;
                    /** @description 商品的SKU编码 */
                    sku_code?: string;
                    /** @description 库存 */
                    inventory_dto_list?: {
                        /** @description 仓库code，默认不填 */
                        store_code?: string;
                        /** @description 想设置的库存 */
                        current_inventory?: number;
                        /** @description 原始库存 */
                        src_inventory?: number;
                    }[];
                }[];
            };
            /** @description 商品类型，在线批发商品(wholesale)或者询盘商品(sourcing)，值为wholesale时，必须填写wholesale_trade */
            product_type: string;
            /** @description 询盘商品交易信息 */
            sourcing_trade?: {
                /** @description 发货港口 */
                delivery_port?: string;
                /** @description 发货期限 */
                delivery_time?: string;
                /** @description FOB货币价格，枚举值 */
                fob_currency?: string;
                /** @description FOB最大价格 */
                fob_max_price?: string;
                /** @description FOB最小价格 */
                fob_min_price?: string;
                /** @description FOB计量单位，枚举值 */
                fob_unit_type?: string;
                /** @description 最小起订量 */
                min_order_quantity?: string;
                /** @description 最小起订量计量单位，枚举值 */
                min_order_unit_type?: string;
                /** @description 付款方式，枚举值 */
                payment_methods?: string[];
                /** @description 供货能力周期，枚举值 */
                supply_period_type?: string;
                /** @description 供货能力 */
                supply_quantity?: string;
                /** @description 供货能力计量单位，枚举值 */
                supply_unit_type?: string;
                /** @description 包装信息 */
                packaging_desc?: string;
                /** @description 发货周期，发货时间相关建议使用此项 */
                deliver_periods?: {
                    /** @description 预计需要发货时间 */
                    process_period?: number;
                    /** @description 数量 */
                    quantity?: number;
                }[];
            };
            /** @description 商品名称，最多128个字符 */
            subject: string;
            /** @description 在线批发商品交易信息 */
            wholesale_trade?: {
                /** @description 每批数量，当sale_type=batch时生效，范围是1-99999 */
                batch_number?: number;
                /** @description 备货期，单位是天，范围是1-60 */
                handling_time?: number;
                /** @description 最小起订量，范围是1-99999 */
                min_order_quantity?: number;
                /** @description 尺寸，单位是厘米，长宽高范围是1-9999999 */
                package_size?: string;
                /** @description 价格，单位是美元，精确到小数点后两位，范围是0.01-9999999.00 */
                price?: string;
                /** @description 销售方式，按件卖(normal)或者按批卖(batch) */
                sale_type?: string;
                /** @description 运费模板ID */
                shipping_line_template_id?: number;
                /** @description 最小计量单位，枚举值 */
                unit_type?: string;
                /** @description 重量，单位是kg，精确到小数点后三位，范围是0.01-9999999.000 */
                weight?: string;
                /** @description 发货周期，发货时间相关建议使用此项 */
                deliver_periods?: {
                    /** @description 预计需要发货时间 */
                    process_period?: number;
                    /** @description 数量 */
                    quantity?: number;
                }[];
            };
            /** @description 发布的市场，支持main，发到主市场 */
            market?: string;
            /** @description 是否智能编辑，如果不传，默认为false */
            is_smart_edit?: boolean;
            /** @description 定制信息 */
            custom_info?: {
                /** @description 定制内容 */
                custom_contents?: {
                    /** @description 最小起订量 */
                    min_order_quantity?: number;
                    /** @description 定制类型，只允许填写英文字符 */
                    custom_type?: string;
                }[];
            };
        };
        /** alibaba.icbu.product.add response */
        AlibabaProductAlibabaIcbuProductAddResponse: {
            /** @description 混淆后的产品ID */
            product_id?: string;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.product.batch.update.display request */
        AlibabaProductAlibabaIcbuProductBatchUpdateDisplayRequest: {
            /** @description on表示上架，off表示下架 */
            new_display: string;
            /** @description 用逗号分隔的混淆id字符串 */
            product_id_list: string;
        };
        /** alibaba.icbu.product.batch.update.display response */
        AlibabaProductAlibabaIcbuProductBatchUpdateDisplayResponse: {
            /** @description 只有出错才会显示，唯一标识这次请求 */
            trace_id?: string;
            /** @description 如果出错，这里会显示错误码 */
            sub_error_code?: string;
            /** @description 具体出错信息 */
            sub_error_msg?: string;
            /** @description 本次操作是否成功，true表示成功，false表示失败 */
            sub_success?: boolean;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.product.get request */
        AlibabaProductAlibabaIcbuProductGetRequest: {
            /** @description 商品语种，目前只支持ENGLISH */
            language: string;
            /** @description 混淆后的商品ID */
            product_id: string;
        };
        /** alibaba.icbu.product.get response */
        AlibabaProductAlibabaIcbuProductGetResponse: {
            /** @description 单个商品详情 */
            product?: {
                /** @description 商品属性 */
                attributes?: {
                    /** @description 属性ID */
                    attribute_id?: number;
                    /** @description 属性名称 */
                    attribute_name?: string;
                    /** @description 作为sku属性值时，用图形来显示；必须是alibaba图片中心的图片URL，请使用alibaba.icbu.photobank.upload上传图片 */
                    sku_custom_image_url?: string;
                    /** @description 作为sku属性值时，自定义属性值名称 */
                    sku_custom_value_name?: string;
                    /** @description 属性值ID */
                    value_id?: number;
                    /** @description 属性值名称 */
                    value_name?: string;
                }[];
                /** @description 类目ID */
                category_id?: number;
                /** @description 商品详情描述 */
                description?: string;
                /** @description 商品分组ID */
                group_id?: number;
                /** @description 关键词 */
                keywords?: string[];
                /** @description 商品的主图 */
                main_image?: {
                    /** @description alibaba图片中心的图片URL列表，请使用alibaba.icbu.photobank.upload接口上传图片 */
                    images?: string[];
                    /** @description 是否打水印，是(true)或否(false) */
                    watermark?: boolean;
                    /** @description 水印是否有边框，有边框(Y)或者无边框(N) */
                    watermark_frame?: string;
                    /** @description 水印位置，在中间(center)或者在底部(bottom) */
                    watermark_position?: string;
                };
                /** @description 商品SKU */
                product_sku?: {
                    /** @description SKU使用的属性 */
                    sku_attributes?: {
                        /** @description 属性ID */
                        attribute_id?: number;
                        /** @description 属性名称 */
                        attribute_name?: string;
                        /** @description 属性下的值 */
                        values?: {
                            /** @description 自定义的属性值名称 */
                            custom_value_name?: string;
                            /** @description 自定义的图片URL */
                            image_url?: string;
                            /** @description 默认的展示样式 */
                            mark_info?: string;
                            /** @description 默认的属性值名称 */
                            system_value_name?: string;
                            /** @description 属性值ID */
                            value_id?: number;
                        }[];
                    }[];
                    /** @description SKU定义 */
                    skus?: {
                        /** @description attr2Value */
                        attr2_value?: string;
                        /** @description 根据订单数量设置折扣价 */
                        bulk_discount_prices?: {
                            /** @description 价格，范围是0.01-9999999.00 */
                            price?: string;
                            /** @description 起始数量，范围是1-99999 */
                            start_quantity?: number;
                        }[];
                        /** @description 商品的SKU编码 */
                        sku_code?: string;
                        /** @description 商品的SKUid，唯一标识SKU */
                        sku_id?: number;
                        /** @description 商品的库存列表 */
                        inventory_dto_list?: {
                            /** @description 库存编码，为空时表示默认国内仓 */
                            store_code?: string;
                            /** @description 库存值 */
                            inventory?: number;
                        }[];
                    }[];
                };
                /** @description 询盘商品交易信息 */
                sourcing_trade?: {
                    /** @description 发货港口 */
                    delivery_port?: string;
                    /** @description 发货期限 */
                    delivery_time?: string;
                    /** @description FOB价格货币，参见FAQ 货币枚举值 */
                    fob_currency?: string;
                    /** @description FOB最大价格 */
                    fob_max_price?: string;
                    /** @description FOB最小价格 */
                    fob_min_price?: string;
                    /** @description FOB计量单位，参见FAQ 计量单位枚举值 */
                    fob_unit_type?: string;
                    /** @description 最小起订量 */
                    min_order_quantity?: string;
                    /** @description 最小起订量计量单位，参见FAQ 计量单位枚举值 */
                    min_order_unit_type?: string;
                    /** @description 付款方式，参见FAQ 付款方式枚举值 */
                    payment_methods?: string[];
                    /** @description 供货能力周期，参见FAQ 时间周期枚举值 */
                    supply_period_type?: string;
                    /** @description 供货能力 */
                    supply_quantity?: string;
                    /** @description 供货能力计量单位，参见FAQ 计量单位枚举值 */
                    supply_unit_type?: string;
                    /** @description 常规包装 */
                    packaging_desc?: string;
                    /** @description 阶梯交期 */
                    deliver_periods?: {
                        /** @description 《=最大订购量 */
                        quantity?: number;
                        /** @description 发货时间 */
                        process_period?: number;
                    }[];
                };
                /** @description status 的值：sketch：草稿，approved：审核通过，tbd：审核不通过，new 、modified ：审核中 */
                status?: string;
                /** @description 商品名称 */
                subject?: string;
                /** @description 在线批发商品交易信息 */
                wholesale_trade?: {
                    /** @description 每批数量，当sale_type=batch时生效，范围是1-99999 */
                    batch_number?: number;
                    /** @description 备货期，单位是天，范围是1-60 */
                    handling_time?: number;
                    /** @description 最小起订量，必须是batch_number的整数倍，范围是1-99999 */
                    min_order_quantity?: number;
                    /** @description 尺寸，单位是厘米，长宽高范围是1-9999999 */
                    package_size?: string;
                    /** @description 价格，单位是美元，精确到小数点后两位，范围是0.01-9999999.00 */
                    price?: string;
                    /** @description 销售方式，按件卖(normal)或者按批卖(batch) */
                    sale_type?: string;
                    /** @description 运费模板ID */
                    shipping_line_template_id?: number;
                    /** @description 最小计量单位，参见FAQ 计量单位枚举值 */
                    unit_type?: string;
                    /** @description 体积，单位是立方厘米，范围是1-9999999 */
                    volume?: number;
                    /** @description 重量，单位是kg，精确到小数点后三位，范围是0.01-9999999.000 */
                    weight?: string;
                    /** @description 阶梯交期 */
                    deliver_periods?: {
                        /** @description 最大订购量 */
                        quantity?: number;
                        /** @description 发货时间 */
                        process_period?: number;
                    }[];
                };
                /** @description 语种 */
                language?: string;
                /** @description 商品类型 */
                product_type?: string;
                /** @description 产品负责人 */
                owner_member?: number;
                /** @description Y为上架状态 */
                display?: string;
                /** @description 产品更新时间 */
                gmt_modified?: number | string;
                /** @description 产品负责人显示名，由firstname和lastname拼接组成 */
                owner_member_display_name?: string;
                /** @description 定制信息 */
                custom_info?: {
                    /** @description 定制项 */
                    custom_contents?: {
                        /** @description 定制类型 */
                        custom_type?: string;
                        /** @description 定制最小起订量 */
                        min_order_quantity?: number;
                    }[];
                };
                /** @description 是否是智能编辑 */
                is_smart_edit?: boolean;
                /** @description /**      * SKU价      *\/     SKU_PRICE("sku_price"),     /**      * 阶梯价      *\/     LADDER_PRICE("ladder_price"),     /**      * fob价: 单一区间fob价      *\/     FOB_PRICE("fob_price"); */
                price_type?: string;
                /** @description https://www.alibaba.com/product-detail/Short-Umbrella-Girls-Black-Lace-Polka_1600107214049.html?spm=a2700.galleryofferlist.normalList.12.6c612db4ueHAW2 */
                pc_detail_url?: string;
                /** @description 是否是有效rts */
                rts?: boolean;
                /** @description 产品ID */
                product_id?: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.product.group.add request */
        AlibabaProductAlibabaIcbuProductGroupAddRequest: {
            /** @description 分组名称 */
            group_name: string;
            /** @description 上级分组ID，如果建立顶级分组设为-1 */
            parent_id: number;
            /** @description 补充信息，如isv id */
            extra_context?: {
                [key: string]: unknown;
            };
        };
        /** alibaba.icbu.product.group.add response */
        AlibabaProductAlibabaIcbuProductGroupAddResponse: {
            /** @description 创建的分组信息 */
            product_group?: {
                /** @description 上级分组ID */
                parent_id?: number;
                /** @description 分组ID */
                group_id?: number;
                /** @description 分组名称 */
                group_name?: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.product.group.get request */
        AlibabaProductAlibabaIcbuProductGroupGetRequest: {
            /** @description 补充信息 */
            extra_context?: {
                [key: string]: unknown;
            };
            /** @description 分组ID，传-1获得所有一级分组 */
            group_id: number;
        };
        /** alibaba.icbu.product.group.get response */
        AlibabaProductAlibabaIcbuProductGroupGetResponse: {
            /** @description 分组信息 */
            product_group?: {
                /** @description 下级分组ID列表 */
                children_id_list?: number[];
                /** @description 分组ID */
                group_id?: number;
                /** @description 分组名称 */
                group_name?: string;
                /** @description 父节点id，父节点处在分组树的一级 */
                parent_id?: number;
                /** @description 父节点id，父节点处在分组树的二级 */
                parent_id2?: number;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.product.id.decrypt request */
        AlibabaProductAlibabaIcbuProductIdDecryptRequest: {
            /** @description 语种 */
            language: string;
            /** @description 混淆后的商品ID */
            product_id: string;
        };
        /** alibaba.icbu.product.id.decrypt response */
        AlibabaProductAlibabaIcbuProductIdDecryptResponse: {
            /** @description 商品ID */
            id?: number;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.product.list request */
        AlibabaProductAlibabaIcbuProductListRequest: {
            /** @description 类目ID */
            category_id?: number;
            /** @description 当前页 */
            current_page?: number;
            /** @description 每页大小，最大30 */
            page_size?: number;
            /** @description 商品名称，支持模糊匹配 */
            subject?: string;
            /** @description 商品语种，目前只支持ENGLISH */
            language: string;
            /** @description 商品三级分组id，可选填。若填写-1 则表示取回的商品没有三级分组，不填入代表取回的商品不关心它的三级分组，填写对应的group id将返回这个分组下的商品 */
            group_id3?: number;
            /** @description 商品二级分组id，可选填。若填写-1 则表示取回的商品没有二级分组，不填入代表取回的商品不关系它的二级分组，填写对应的group id将返回这个分组下的商品 */
            group_id2?: number;
            /** @description 商品一级分组id，可选填。若填写0 则表示取回的商品没有一级分组，不填入代表取回的商品不关心它的一级分组，填写对应的group id将返回这个分组下的商品 */
            group_id1?: number;
            /** @description 商品明文id */
            id?: number;
            /** @description 最晚修改时间，格式yyyy-MM-dd HH:mm:ss */
            gmt_modified_to?: string;
            /** @description 最早修改时间，格式yyyy-MM-dd HH:mm:ss */
            gmt_modified_from?: string;
        };
        /** alibaba.icbu.product.list response */
        AlibabaProductAlibabaIcbuProductListResponse: {
            /** @description 当前页 */
            current_page?: number;
            /** @description 每页大小 */
            page_size?: number;
            /** @description 商品概要信息列表 */
            products?: {
                /** @description 分组ID */
                group_id?: number;
                /** @description 分组名称 */
                group_name?: string;
                /** @description 商品明文ID */
                id?: number;
                /** @description 关键词 */
                keywords?: string[];
                /** @description 商品的主图 */
                main_image?: {
                    /** @description alibaba图片中心的图片URL列表，请使用alibaba.icbu.photobank.upload接口上传图片 */
                    images?: string[];
                    /** @description 是否打水印，是(true)或否(false) */
                    watermark?: boolean;
                    /** @description 水印是否有边框，有边框(Y)或者无边框(N) */
                    watermark_frame?: string;
                    /** @description 水印位置，在中间(center)或者在底部(bottom) */
                    watermark_position?: string;
                };
                /** @description 商品状态 */
                status?: string;
                /** @description 商品名称 */
                subject?: string;
                /** @description sourcing或者wholesale */
                product_type?: string;
                /** @description english */
                language?: string;
                /** @description Y表示上架，N表示下架 */
                display?: string;
                /** @description james */
                owner_member_display_name?: string;
                /** @description 1234 */
                category_id?: number;
                /** @description true */
                is_specific?: boolean;
                /** @description true */
                is_rts?: boolean;
                /** @description https://www.alibaba.com/product-detail/Eco-Friendly-100-Biodegradable-Cornstarch-Trash_60832548452.html?spm=a2700.galleryofferlist.normalList.12.6c612db4ueHAW2&fullFirstScreen=true */
                pc_detail_url?: string;
                /** @description true */
                smart_edit?: boolean;
                /** @description 2020-12-22 12:00:00 */
                gmt_create?: number | string;
                /** @description 2020-12-22 12:00:00 */
                gmt_modified?: number | string;
                /** @description CK001 */
                red_model?: string;
                /** @description 产品混淆id */
                product_id?: string;
            }[];
            /** @description 总数 */
            total_item?: number;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.product.schema.add.draft request */
        AlibabaProductAlibabaIcbuProductSchemaAddDraftRequest: {
            /** @description Schema 草稿请求 */
            param_product_top_publish_request: {
                /** @description 叶子类目 ID */
                cat_id: number;
                /** @description 商品语言 */
                language: string;
                /** @description 填写完成的 Schema XML */
                xml: string;
            };
        };
        /** alibaba.icbu.product.schema.add.draft response */
        AlibabaProductAlibabaIcbuProductSchemaAddDraftResponse: {
            /** @description 草稿商品 ID */
            product_id?: string;
            /** @description 调用链路 ID */
            trace_id?: string;
            /** @description 业务是否成功 */
            biz_success?: boolean;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.product.schema.add request */
        AlibabaProductAlibabaIcbuProductSchemaAddRequest: {
            /** @description Schema 发布请求 */
            param_product_top_publish_request: {
                /** @description 叶子类目 ID */
                cat_id: number;
                /** @description 商品语言 */
                language: string;
                /** @description 填写完成的 Schema XML */
                xml: string;
            };
        };
        /** alibaba.icbu.product.schema.add response */
        AlibabaProductAlibabaIcbuProductSchemaAddResponse: {
            /** @description 商品 ID */
            product_id?: string;
            /** @description 调用链路 ID */
            trace_id?: string;
            /** @description 业务是否成功 */
            biz_success?: boolean;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.product.schema.get request */
        AlibabaProductAlibabaIcbuProductSchemaGetRequest: {
            /** @description 商品规则渲染请求 */
            param_product_top_publish_request?: {
                /** @description 类目id */
                cat_id?: number;
                /** @description 返回文案的语种，支持en_US,zh,zh_TW */
                language?: string;
            };
        };
        /** alibaba.icbu.product.schema.get response */
        AlibabaProductAlibabaIcbuProductSchemaGetResponse: {
            /** @description 商品发布规则 */
            data?: string;
            /** @description 错误信息，数组形式的字符串，用;分割，支持中英繁，按照传入的语种参数决定 */
            message?: string;
            /** @description 返回的错误码，数组形式的字符串，用;分割 */
            msg_code?: string;
            /** @description 请求是否成功 */
            biz_success?: boolean;
            /** @description 错误追踪码，请务必打印在日志中，后续排查问题请提交此错误追踪码 */
            trace_id?: string;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.product.schema.render.draft request */
        AlibabaProductAlibabaIcbuProductSchemaRenderDraftRequest: {
            /** @description 商品规则渲染请求 */
            param_product_top_publish_request?: {
                /** @description 类目id */
                cat_id?: number;
                /** @description 返回文案的语种，支持en_US,zh,zh_TW */
                language?: string;
                product_id?: number | string;
            };
        };
        /** alibaba.icbu.product.schema.render.draft response */
        AlibabaProductAlibabaIcbuProductSchemaRenderDraftResponse: {
            /** @description 商品发布规则和对应填写数据 */
            data?: string;
            /** @description 错误信息，数组形式的字符串，用;分割，支持中英繁，按照传入的语种参数决定 */
            message?: string;
            /** @description 返回的错误码，数组形式的字符串，用;分割 */
            msg_code?: string;
            /** @description 请求是否成功 */
            biz_success?: boolean;
            /** @description 错误追踪码，请务必打印在日志中，后续排查问题请提交此错误追踪码 */
            trace_id?: string;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.product.schema.render request */
        AlibabaProductAlibabaIcbuProductSchemaRenderRequest: {
            /** @description 商品规则渲染请求 */
            param_product_top_publish_request?: {
                /** @description 类目id */
                cat_id?: number;
                /** @description 返回文案的语种，支持en_US,zh,zh_TW */
                language?: string;
                product_id?: number | string;
            };
        };
        /** alibaba.icbu.product.schema.render response */
        AlibabaProductAlibabaIcbuProductSchemaRenderResponse: {
            /** @description 商品发布规则和对应填写数据 */
            data?: string;
            /** @description 错误信息，数组形式的字符串，用;分割，支持中英繁，按照传入的语种参数决定 */
            message?: string;
            /** @description 返回的错误码，数组形式的字符串，用;分割 */
            msg_code?: string;
            /** @description 请求是否成功 */
            biz_success?: boolean;
            /** @description 错误追踪码，请务必打印在日志中，后续排查问题请提交此错误追踪码 */
            trace_id?: string;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.product.schema.update request */
        AlibabaProductAlibabaIcbuProductSchemaUpdateRequest: {
            /** @description 发布入参 */
            param_product_top_publish_request: {
                /** @description 类目id */
                cat_id?: number;
                /** @description 返回文案的语种，支持en_US,zh,zh_TW */
                language?: string;
                /** @description 商品明文id */
                product_id?: number;
                /** @description 商品的具体数据信息 */
                xml?: string;
            };
        };
        /** alibaba.icbu.product.schema.update response */
        AlibabaProductAlibabaIcbuProductSchemaUpdateResponse: {
            /** @description 商品明文id */
            product_id?: number;
            /** @description 错误信息，数组形式的字符串，用;分割，支持中英繁，按照传入的语种参数决定 */
            message?: string;
            /** @description 返回的错误码，数组形式的字符串，用;分割 */
            msg_code?: string;
            /** @description 调用是否成功 */
            biz_success?: boolean;
            /** @description 错误追踪码，请务必打印在日志中，后续排查问题请提交此错误追踪码 */
            trace_id?: string;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.product.score.get request */
        AlibabaProductAlibabaIcbuProductScoreGetRequest: {
            /** @description 混淆后的商品ID */
            product_id: string;
        };
        /** alibaba.icbu.product.score.get response */
        AlibabaProductAlibabaIcbuProductScoreGetResponse: {
            /** @description 系统自动生成 */
            result?: {
                /** @description 精品标，，返回字段中 boutique_tag 含义： 1 精品 2 普通品 3 低质品 4 实力优品 */
                boutique_tag?: number;
                /** @description 质量分 */
                final_score?: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.product.update.field request */
        AlibabaProductAlibabaIcbuProductUpdateFieldRequest: {
            /** @description 商品属性和属性值 */
            attributes?: {
                /** @description 属性ID */
                attribute_id?: number;
                /** @description 属性名称 */
                attribute_name?: string;
                /** @description 属性值ID */
                value_id?: number;
                /** @description 属性值名称 */
                value_name?: string;
                /** @description 作为sku属性值时，用图形来展示；必须是alibaba图片中心的图片URL，请使用API alibaba.icbu.photobank.upload 上传图片 */
                sku_custom_image_url?: string;
                /** @description 作为sku属性值时，自定义属性值名称 */
                sku_custom_value_name?: string;
            }[];
            /** @description 根据数量设置的折扣价 */
            bulk_discount_prices?: {
                /** @description 价格，范围是0.01-9999999.00 */
                price?: string;
                /** @description 起始数量，范围是1-99999 */
                start_quantity?: number;
            }[];
            /** @description 类目ID */
            category_id?: number;
            /** @description 商品详情描述，可包含图片中心的图片URL */
            description?: string;
            /** @description 补充信息 */
            extra_context?: {
                [key: string]: unknown;
            };
            /** @description 分组ID */
            group_id?: number;
            /** @description 关键词，不要包含特殊符号（如,;），最多三个 */
            keywords?: string[];
            /** @description 语种，当前只有english */
            language: string;
            /** @description 商品主图 */
            main_image?: {
                /** @description alibaba图片中心的图片URL列表，请使用alibaba.icbu.photobank.upload接口上传图片 */
                images?: string[];
                /** @description 是否打水印，是(true)或否(false) */
                watermark?: boolean;
                /** @description 水印是否有边框，有边框(Y)或者无边框(N) */
                watermark_frame?: string;
                /** @description 水印位置，在中间(center)或者在底部(bottom) */
                watermark_position?: string;
            };
            /** @description 商品SKU定义 */
            product_sku?: {
                /** @description 商品属性和属性值 */
                attributes?: {
                    /** @description 属性ID */
                    attribute_id?: number;
                    /** @description 作为sku属性值时，用图形来显示；必须是alibaba图片中心的图片URL，请使用alibaba.icbu.photobank.upload上传图片 */
                    sku_custom_image_url?: string;
                    /** @description 作为sku属性值时，自定义属性值名称 */
                    sku_custom_value_name?: string;
                    /** @description 属性值ID，自定义属性值时ID要小于0，并且不能重复 */
                    value_id?: number;
                    /** @description 属性名称 */
                    attribute_name?: string;
                    /** @description 属性值名称 */
                    value_name?: string;
                }[];
                /** @description 单个SKU详细定义 */
                exclude_skus?: {
                    /** @description 商品属性和属性值 */
                    attributes?: {
                        /** @description 属性ID */
                        attribute_id?: number;
                        /** @description 属性值ID，自定义属性值时ID要小于0，并且不能重复 */
                        value_id?: number;
                        /** @description 作为sku属性值时，自定义属性值名称 */
                        sku_custom_value_name?: string;
                        /** @description 作为sku属性值时，用图形来展示；必须是alibaba图片中心的图片URL，请使用API alibaba.icbu.photobank.upload 上传图片 */
                        sku_custom_image_url?: string;
                        /** @description 属性名称 */
                        attribute_name?: string;
                        /** @description 属性值名称 */
                        value_name?: string;
                    }[];
                    /** @description 价格，单位是美元，精确到小数点后两位，范围是0.01-9999999.00 */
                    price?: string;
                }[];
                /** @description 单个SKU详细定义 */
                special_skus?: {
                    /** @description 商品属性和属性值 */
                    attributes?: {
                        /** @description 属性ID */
                        attribute_id?: number;
                        /** @description 属性值ID，自定义属性值时ID要小于0，并且不能重复 */
                        value_id?: number;
                        /** @description 作为sku属性值时，自定义属性值名称 */
                        sku_custom_value_name?: string;
                        /** @description 作为sku属性值时，用图形来展示；必须是alibaba图片中心的图片URL，请使用API alibaba.icbu.photobank.upload 上传图片 */
                        sku_custom_image_url?: string;
                        /** @description 属性名称 */
                        attribute_name?: string;
                        /** @description 属性值名称 */
                        value_name?: string;
                    }[];
                    /** @description 价格，单位是美元，精确到小数点后两位，范围是0.01-9999999.00 */
                    price?: string;
                    /** @description SKU编码 */
                    sku_code?: string;
                    /** @description SKU id，唯一标识一个SKU */
                    sku_id?: number;
                    /** @description 库存对象列表 */
                    inventory_dto_list?: {
                        /** @description 原始的库存,如果不确定，直接置0，同时skuId也置空 */
                        src_inventory?: number;
                        /** @description 当前想设置的库存 */
                        current_inventory?: number;
                        /** @description 仓code，不填表示默认国内仓 */
                        store_code?: string;
                    }[];
                }[];
            };
            /** @description 商品类型，在线批发商品(wholesale)或者询盘商品(sourcing) */
            product_type: string;
            /** @description 询盘商品交易信息 */
            sourcing_trade?: {
                /** @description 发货港口 */
                delivery_port?: string;
                /** @description 发货期限 */
                delivery_time?: string;
                /** @description FOB价格货币，参见FAQ 货币枚举值 */
                fob_currency?: string;
                /** @description FOB最大价格 */
                fob_max_price?: string;
                /** @description FOB最小价格 */
                fob_min_price?: string;
                /** @description FOB计量单位，参见FAQ 计量单位枚举值 */
                fob_unit_type?: string;
                /** @description 最小起订量 */
                min_order_quantity?: string;
                /** @description 最小起订量计量单位，参见FAQ 计量单位枚举值 */
                min_order_unit_type?: string;
                /** @description 付款方式，参见FAQ 付款方式枚举值 */
                payment_methods?: string[];
                /** @description 供货能力周期，参见FAQ 时间周期枚举值 */
                supply_period_type?: string;
                /** @description 供货能力 */
                supply_quantity?: string;
                /** @description 供货能力计量单位，参见FAQ 计量单位枚举值 */
                supply_unit_type?: string;
                /** @description 包装信息 */
                packaging_desc?: string;
                /** @description 发货周期，发货时间相关建议使用此项 */
                deliver_periods?: {
                    /** @description 预计需要发货时间 */
                    process_period?: number;
                    /** @description 数量 */
                    quantity?: number;
                }[];
            };
            /** @description 商品名称，最多128个字符 */
            subject?: string;
            /** @description 在线批发商品交易信息 */
            wholesale_trade?: {
                /** @description 每批数量，当sale_type=batch时生效，范围是1-99999 */
                batch_number?: number;
                /** @description 备货期，单位是天，范围是1-60 */
                handling_time?: number;
                /** @description 最小起订量，范围是1-99999 */
                min_order_quantity?: number;
                /** @description 尺寸，单位是厘米，长宽高范围是1-9999999 */
                package_size?: string;
                /** @description 价格，单位是美元，精确到小数点后两位，范围是0.01-9999999.00 */
                price?: string;
                /** @description 销售方式，按件卖(normal)或者按批卖(batch) */
                sale_type?: string;
                /** @description 运费模板ID */
                shipping_line_template_id?: number;
                /** @description 最小计量单位，参见FAQ 计量单位枚举值 */
                unit_type?: string;
                /** @description 重量，单位是kg，精确到小数点后三位，范围是0.01-9999999.000 */
                weight?: string;
                /** @description 发货周期，发货时间相关建议使用此项 */
                deliver_periods?: {
                    /** @description 预计需要发货时间 */
                    process_period?: number;
                    /** @description 数量 */
                    quantity?: number;
                }[];
            };
            /** @description 发布的市场，支持main/onesite，默认main发到主市场，填onesite发布为商机通产品 */
            market?: string;
            /** @description 定制信息 */
            custom_info?: {
                /** @description 定制内容 */
                custom_contents?: {
                    /** @description 最小起订量 */
                    min_order_quantity?: number;
                    /** @description 定制类型，只允许填写英文字符 */
                    custom_type?: string;
                }[];
            };
            /** @description 商品详情种类，true表示智能编辑，不填默认取商品原来的详情种类 */
            is_smart_edit?: boolean;
            /** @description 使用SKU价的时候需要传入这个参数 */
            use_sku_price?: boolean;
            /** @description 混淆商品ID */
            product_id: string;
        };
        /** alibaba.icbu.product.update.field response */
        AlibabaProductAlibabaIcbuProductUpdateFieldResponse: {
            /** @description 加密后的产品ID */
            product_id?: string;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.product.update request */
        AlibabaProductAlibabaIcbuProductUpdateRequest: {
            /** @description 商品属性和属性值 */
            attributes?: {
                /** @description 属性ID */
                attribute_id?: number;
                /** @description 属性名称 */
                attribute_name?: string;
                /** @description 属性值ID */
                value_id?: number;
                /** @description 属性值名称 */
                value_name?: string;
                /** @description 作为sku属性值时，用图形来展示；必须是alibaba图片中心的图片URL，请使用API alibaba.icbu.photobank.upload 上传图片 */
                sku_custom_image_url?: string;
                /** @description 作为sku属性值时，自定义属性值名称 */
                sku_custom_value_name?: string;
            }[];
            /** @description 根据数量设置的折扣价 */
            bulk_discount_prices?: {
                /** @description 价格，范围是0.01-9999999.00 */
                price?: string;
                /** @description 起始数量，范围是1-99999 */
                start_quantity?: number;
            }[];
            /** @description 类目ID */
            category_id: number;
            /** @description 商品详情描述，可包含图片中心的图片URL */
            description?: string;
            /** @description 补充信息 */
            extra_context?: {
                [key: string]: unknown;
            };
            /** @description 分组ID */
            group_id?: number;
            /** @description 关键词，不要包含特殊符号（如,;），最多三个 */
            keywords: string[];
            /** @description 语种，参见FAQ 语种枚举值 */
            language: string;
            /** @description 商品主图 */
            main_image: {
                /** @description alibaba图片中心的图片URL列表，请使用alibaba.icbu.photobank.upload接口上传图片 */
                images: string[];
                /** @description 是否打水印，是(true)或否(false) */
                watermark?: boolean;
                /** @description 水印是否有边框，有边框(Y)或者无边框(N) */
                watermark_frame?: string;
                /** @description 水印位置，在中间(center)或者在底部(bottom) */
                watermark_position?: string;
            };
            /** @description 商品SKU定义 */
            product_sku?: {
                /** @description 商品属性和属性值 */
                attributes?: {
                    /** @description 属性ID */
                    attribute_id?: number;
                    /** @description 作为sku属性值时，用图形来显示；必须是alibaba图片中心的图片URL，请使用alibaba.icbu.photobank.upload上传图片 */
                    sku_custom_image_url?: string;
                    /** @description 作为sku属性值时，自定义属性值名称 */
                    sku_custom_value_name?: string;
                    /** @description 属性值ID，自定义属性值时ID要小于0，并且不能重复 */
                    value_id?: number;
                    /** @description 属性值名称 */
                    value_name?: string;
                    /** @description 属性名称 */
                    attribute_name?: string;
                }[];
                /** @description 单个SKU详细定义 */
                exclude_skus?: {
                    /** @description 商品属性和属性值 */
                    attributes?: {
                        /** @description 属性ID */
                        attribute_id?: number;
                        /** @description 属性值ID，自定义属性值时ID要小于0，并且不能重复 */
                        value_id?: number;
                        /** @description 作为sku属性值时，自定义属性值名称 */
                        sku_custom_value_name?: string;
                        /** @description 作为sku属性值时，用图形来展示；必须是alibaba图片中心的图片URL，请使用API alibaba.icbu.photobank.upload 上传图片 */
                        sku_custom_image_url?: string;
                        /** @description 属性值名称 */
                        value_name?: string;
                        /** @description 属性名称 */
                        attribute_name?: string;
                    }[];
                    /** @description 价格，单位是美元，精确到小数点后两位，范围是0.01-9999999.00 */
                    price?: string;
                }[];
                /** @description 单个SKU详细定义 */
                special_skus?: {
                    /** @description 商品属性和属性值 */
                    attributes?: {
                        /** @description 属性ID */
                        attribute_id?: number;
                        /** @description 属性值ID，自定义属性值时ID要小于0，并且不能重复 */
                        value_id?: number;
                        /** @description 作为sku属性值时，自定义属性值名称 */
                        sku_custom_value_name?: string;
                        /** @description 作为sku属性值时，用图形来展示；必须是alibaba图片中心的图片URL，请使用API alibaba.icbu.photobank.upload 上传图片 */
                        sku_custom_image_url?: string;
                        /** @description 属性值名称 */
                        value_name?: string;
                        /** @description 属性名称 */
                        attribute_name?: string;
                    }[];
                    /** @description 价格，单位是美元，精确到小数点后两位，范围是0.01-9999999.00 */
                    price?: string;
                }[];
            };
            /** @description 商品类型，在线批发商品(wholesale)或者询盘商品(sourcing) */
            product_type: string;
            /** @description 询盘商品交易信息 */
            sourcing_trade?: {
                /** @description 发货港口 */
                delivery_port?: string;
                /** @description 发货期限 */
                delivery_time?: string;
                /** @description FOB价格货币，参见FAQ 货币枚举值 */
                fob_currency?: string;
                /** @description FOB最大价格 */
                fob_max_price?: string;
                /** @description FOB最小价格 */
                fob_min_price?: string;
                /** @description FOB计量单位，参见FAQ 计量单位枚举值 */
                fob_unit_type?: string;
                /** @description 最小起订量 */
                min_order_quantity?: string;
                /** @description 最小起订量计量单位，参见FAQ 计量单位枚举值 */
                min_order_unit_type?: string;
                /** @description 付款方式，参见FAQ 付款方式枚举值 */
                payment_methods?: string[];
                /** @description 供货能力周期，参见FAQ 时间周期枚举值 */
                supply_period_type?: string;
                /** @description 供货能力 */
                supply_quantity?: string;
                /** @description 供货能力计量单位，参见FAQ 计量单位枚举值 */
                supply_unit_type?: string;
                /** @description 包装信息 */
                packaging_desc?: string;
                /** @description 发货周期 */
                deliver_periods?: {
                    /** @description 预计需要发货时间 */
                    process_period?: number;
                    /** @description 数量 */
                    quantity?: number;
                }[];
            };
            /** @description 商品名称，最多128个字符 */
            subject: string;
            /** @description 在线批发商品交易信息 */
            wholesale_trade?: {
                /** @description 每批数量，当sale_type=batch时生效，范围是1-99999 */
                batch_number?: number;
                /** @description 备货期，单位是天，范围是1-60 */
                handling_time?: number;
                /** @description 最小起订量，范围是1-99999 */
                min_order_quantity?: number;
                /** @description 尺寸，单位是厘米，长宽高范围是1-9999999 */
                package_size?: string;
                /** @description 价格，单位是美元，精确到小数点后两位，范围是0.01-9999999.00 */
                price?: string;
                /** @description 销售方式，按件卖(normal)或者按批卖(batch) */
                sale_type?: string;
                /** @description 运费模板ID */
                shipping_line_template_id?: number;
                /** @description 最小计量单位，参见FAQ 计量单位枚举值 */
                unit_type?: string;
                /** @description 体积，单位是立方厘米，范围是1-9999999 */
                volume?: number;
                /** @description 重量，单位是kg，精确到小数点后三位，范围是0.01-9999999.000 */
                weight?: string;
                /** @description 发货周期(新版本，建议使用) */
                deliver_periods?: {
                    /** @description 预计需要发货时间 */
                    process_period?: number;
                    /** @description 数量 */
                    quantity?: number;
                }[];
            };
            /** @description 发布的市场，支持main/onesite，默认main发到主市场，填onesite发布为商机通产品 */
            market?: string;
            /** @description 智能编辑，不填写使用原来的。注意必须和详情的格式一致 */
            is_smart_edit?: boolean;
            /** @description 定制信息 */
            custom_info?: {
                /** @description 定制内容 */
                custom_contents?: {
                    /** @description 最小起订量 */
                    min_order_quantity?: number;
                    /** @description 定制类型 */
                    custom_type?: string;
                }[];
            };
            /** @description 混淆商品ID */
            product_id: string;
        };
        /** alibaba.icbu.product.update response */
        AlibabaProductAlibabaIcbuProductUpdateResponse: {
            /** @description 加密后的产品ID */
            product_id?: string;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.annex.upload request */
        AlibabaRfqAlibabaIcbuAnnexUploadRequest: {
            /** @description 文件名 */
            file_name: string;
            /** @description 文件字节流 */
            file_input_stream_bytes: string;
            /** @description 来源 */
            source: string;
        };
        /** alibaba.icbu.annex.upload response */
        AlibabaRfqAlibabaIcbuAnnexUploadResponse: {
            /** @description 返回错误码 */
            err_type?: string;
            /** @description 错误信息 */
            message?: string;
            /** @description 文件file_str */
            result?: string;
            /** @description 是否成功 */
            is_success?: boolean;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.quotation.post request */
        AlibabaRfqAlibabaIcbuQuotationPostRequest: {
            /** @description 验证 */
            md5key?: string;
            /** @description 报价DTO */
            dto?: {
                /** @description 给买家留言 */
                details: string;
                /** @description 附件file_str,请通过调用alibaba.icbu.annex.upload结果作为入参 */
                annex_files_str?: string;
                /** @description 样本 */
                sample?: {
                    /** @description 备注 */
                    remark?: string;
                    /** @description 预计时间 */
                    estimated_date?: number;
                    /** @description 样品运费支付方 */
                    payment?: string;
                    /** @description 是否是免费 */
                    is_free?: string;
                    /** @description 是否提供样本 */
                    is_support?: string;
                };
                /** @description 报价列表 */
                price_list?: {
                    /** @description 目的港 */
                    port: string;
                    /** @description 发运条件 */
                    shipping_terms: string;
                    /** @description 图片image_str,请通过调用alibaba.icbu.annex.upload结果作为入参如果是都个附件通过\r\n分割 */
                    image_str?: string;
                    /** @description 产品编号 */
                    model_num?: string;
                    /** @description 产品名称 */
                    item_name: string;
                    /** @description 价格 */
                    fob_price: string;
                    /** @description 数量 */
                    quantity: string;
                    /** @description 数量单位 */
                    quantity_unit: string;
                    /** @description 备注 */
                    remark: string;
                    /** @description 价格单位 */
                    fob_price_unit: string;
                }[];
                /** @description RFQID */
                rfq_id: string;
                /** @description 付费条款 */
                payment_terms: string;
                /** @description 过期时间 */
                expiry_date: number | string;
            };
        };
        /** alibaba.icbu.quotation.post response */
        AlibabaRfqAlibabaIcbuQuotationPostResponse: {
            /** @description 请求返回结果信息 */
            result?: {
                /** @description 错误信息 */
                message?: string;
                /** @description 返回结果信息 */
                result?: {
                    /** @description 报价ID */
                    id?: number;
                };
                /** @description 错误类型 */
                err_type?: string;
                /** @description 是否成功 */
                success?: boolean;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.rfqdetail.get request */
        AlibabaRfqAlibabaIcbuRfqdetailGetRequest: {
            /** @description 验证 */
            md5key?: string;
            /** @description 查询RFQ详情DTO */
            rfq_query_dto?: {
                /** @description RFQ ID */
                rfq_id: string;
            };
        };
        /** alibaba.icbu.rfqdetail.get response */
        AlibabaRfqAlibabaIcbuRfqdetailGetResponse: {
            /** @description 返回结果集 */
            result?: {
                /** @description 返回状态信息 */
                message?: string;
                /** @description RFQ详情结果集 */
                result?: {
                    /** @description 附件列表 */
                    attachments?: {
                        /** @description 文件名 */
                        file_name?: string;
                        /** @description 文件地址 */
                        file_url?: string;
                    }[];
                    /** @description RFQ详情 */
                    rfq_detail_dto?: {
                        /** @description 语种 */
                        lang_src?: string;
                        /** @description 供应商国家 */
                        supplier_countrys?: string;
                        /** @description 类目ID */
                        category_id?: number;
                        /** @description 类目名称 */
                        category_name?: string;
                        /** @description 附加名称 */
                        annex_names?: string;
                        /** @description 付款条件 */
                        payment_terms?: string;
                        /** @description 目的港 */
                        destination_port?: string;
                        /** @description 价格单位 */
                        fob_price_unit?: string;
                        /** @description 价格 */
                        fob_price?: string;
                        /** @description 发运条件 */
                        shipping_terms?: string;
                        /** @description 剩余报价数量 */
                        left_count?: number;
                        /** @description 开放时间 */
                        open_time?: number;
                        /** @description 过期值 */
                        expirate_time?: number;
                        /** @description 国家简称 */
                        country_simple?: string;
                        /** @description 数量单位 */
                        quantity_unit?: string;
                        /** @description 数量 */
                        quantity?: number;
                        /** @description 状态 */
                        status?: string;
                        /** @description 描述 */
                        description?: string;
                        /** @description 标题 */
                        subject?: string;
                        /** @description RFQ ID */
                        rfq_id?: string;
                    };
                };
                /** @description 错误类型 */
                error_type?: string;
                /** @description 判断是否成功 */
                success?: boolean;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.rfq.myequity request */
        AlibabaRfqAlibabaIcbuRfqMyequityRequest: Record<string, never>;
        /** alibaba.icbu.rfq.myequity response */
        AlibabaRfqAlibabaIcbuRfqMyequityResponse: {
            /** @description 请求返回结果 */
            service_result?: {
                /** @description 是否成功 */
                success?: boolean;
                /** @description 返回信息 */
                msg?: string;
                /** @description 我的权益信息 */
                value?: {
                    /** @description 剩余权益 */
                    equity_count?: number;
                    /** @description 过期时间 */
                    expired_date?: string;
                    /** @description 市场表现分 */
                    score?: number;
                    /** @description 击败其他供应商百分比 */
                    beat_supplier_percent?: string;
                    /** @description 市场表现分统计开始时间 */
                    statistic_start_date?: string;
                    /** @description 市场表现分统计结束时间 */
                    statistic_end_date?: string;
                    /** @description 剩余置顶报价权益 */
                    top_service_count?: number;
                };
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.rfq.read request */
        AlibabaRfqAlibabaIcbuRfqReadRequest: {
            /** @description 查询RFQID列表 */
            rfq_id_list: string[];
        };
        /** alibaba.icbu.rfq.read response */
        AlibabaRfqAlibabaIcbuRfqReadResponse: {
            /** @description alinkappserver系统返回的通用结果类 */
            result?: {
                /** @description 错误码 */
                code?: string;
                /** @description 错误信息 */
                msg?: string;
                /** @description 操作结果对象 */
                result_code?: number;
                /** @description 是否成功 */
                success?: boolean;
                /** @description 结果 */
                value?: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.rfq.recommend request */
        AlibabaRfqAlibabaIcbuRfqRecommendRequest: {
            /** @description 入参数据 */
            query_dto: {
                /** @description 推荐数量 */
                count: number;
                /** @description 当前页面数 */
                current: number;
                /** @description 页面大小 */
                page_size: number;
                /** @description 系统参数qn-homepage */
                site: string;
                /** @description 系统参数U_P_I */
                type: string;
            };
        };
        /** alibaba.icbu.rfq.recommend response */
        AlibabaRfqAlibabaIcbuRfqRecommendResponse: {
            /** @description alinkappserver系统返回的通用结果类 */
            result?: {
                /** @description 系统信息 */
                msg?: string;
                /** @description 返回系统代码 */
                result_code?: number;
                /** @description 请求是否成功 */
                success?: boolean;
                /** @description 返回结果 */
                value?: {
                    /** @description 返回结果统计 */
                    pagination?: {
                        /** @description 当前页面 */
                        current?: number;
                        /** @description 页面大小 */
                        page_size?: number;
                        /** @description 推荐数量 */
                        total_item?: number;
                        /** @description 总页数 */
                        total_pages?: number;
                    };
                    /** @description 返回推荐RFQ */
                    rfq_list?: {
                        /** @description 国家全称 */
                        country?: string;
                        /** @description 国家简称 */
                        country_simple?: string;
                        /** @description 发布时间戳 */
                        date_post?: number;
                        /** @description 发布时间 */
                        date_post_str?: string;
                        /** @description RFQ详情 */
                        detail?: string;
                        /** @description 是否有读过 */
                        has_read?: boolean;
                        /** @description 是否有图片 */
                        have_image?: boolean;
                        /** @description 图片地址 */
                        image_url?: string;
                        /** @description 剩余报价数 */
                        left_count?: number;
                        /** @description 数量 */
                        quantity?: number;
                        /** @description rfqID */
                        rfq_id?: string;
                        /** @description RFQ标题 */
                        subject?: string;
                        /** @description 数量单位 */
                        quantity_unit?: string;
                    }[];
                };
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.rfq.search request */
        AlibabaRfqAlibabaIcbuRfqSearchRequest: {
            /** @description 验证 */
            md5key?: string;
            /** @description 查询条件 */
            cond?: {
                /** @description 关键词 */
                search_text: string;
                /** @description 每页显示个数 */
                page_size?: number;
                /** @description 过滤RFQ发送时间秒级别的 */
                open_time?: number;
                /** @description 是否有附件 */
                attachment?: boolean;
                /** @description 是否有图片 */
                photo?: boolean;
                /** @description 国家简称 */
                country?: string;
                /** @description 类目 */
                category_id?: string;
                /** @description RFQ发布到现在的结束时间秒级别 */
                close_time?: number;
                /** @description 最小量 */
                quantity_min?: number;
                /** @description 当前页 */
                current_page?: number;
                /** @description 最大量 */
                quantity_max?: number;
                /** @description 是否报满RFQ */
                full_quote?: boolean;
                /** @description 是否限免RFQ */
                zero_quotation?: boolean;
                /** @description 是否过滤已报价 */
                filter_quoted?: boolean;
            };
        };
        /** alibaba.icbu.rfq.search response */
        AlibabaRfqAlibabaIcbuRfqSearchResponse: {
            /** @description 返回信息结果集 */
            result?: {
                /** @description 查询返回信息 */
                message?: string;
                /** @description 结果集 */
                result?: {
                    /** @description RFQ列表 */
                    request_list?: {
                        /** @description RFQID */
                        rfq_id?: string;
                        /** @description 类目ID */
                        category_id?: number;
                        /** @description RFQ标题 */
                        subject?: string;
                        /** @description RFQ内容 */
                        description?: string;
                        /** @description 数量 */
                        quantity?: number;
                        /** @description 数量单位 */
                        quantity_unit?: string;
                        /** @description 国家简称 */
                        country_simple?: string;
                        /** @description 剩余报价 */
                        left_count?: number;
                        /** @description 附件名称 */
                        annex_names?: string;
                        /** @description 语种 */
                        lang_src?: string;
                        /** @description 过期时间 */
                        expirate_time?: number;
                        /** @description 开始时间 */
                        open_time?: number;
                        /** @description 图片地址 */
                        image_url?: string;
                        /** @description 供应商国家 */
                        supplier_countrys?: string;
                        /** @description 附件 */
                        annex_files?: {
                            /** @description 文件名 */
                            file_name?: string;
                            /** @description 唯一文件名 */
                            unique_file_name?: string;
                        }[];
                        /** @description 唯一加密RFQID */
                        unique_rfq_id?: string;
                    }[];
                    /** @description 总数 */
                    total?: number;
                    /** @description 类目列表 */
                    category_list?: {
                        /** @description 类目ID */
                        category_id?: number;
                        /** @description 类目名称 */
                        category_name?: string;
                        /** @description 数量 */
                        count?: number;
                    }[];
                };
                /** @description 错误类型 */
                error_type?: string;
                /** @description 是否成功 */
                success?: boolean;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.check.overseas.admittance request */
        AlibabaTradeAlibabaIcbuCheckOverseasAdmittanceRequest: {
            /** @description 用户国际站账号Id */
            ali_id: number;
        };
        /** alibaba.icbu.check.overseas.admittance response */
        AlibabaTradeAlibabaIcbuCheckOverseasAdmittanceResponse: {
            /** @description 返回结果 */
            result?: {
                /** @description 异常 */
                exception?: string;
                /** @description 错误码 */
                code?: string;
                /** @description 是否准入海外现货 */
                response?: boolean;
                /** @description 错误提示文案 */
                message?: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.ecology.write request */
        AlibabaTradeAlibabaIcbuEcologyWriteRequest: {
            /** @description 唯一标志 */
            symbol: string;
        };
        /** alibaba.icbu.ecology.write response */
        AlibabaTradeAlibabaIcbuEcologyWriteResponse: {
            /** @description 生态准入是否成功 */
            value?: string;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.snsoft.account.bill.sync request */
        AlibabaTradeAlibabaIcbuSnsoftAccountBillSyncRequest: {
            /** @description 请求参数 */
            south_north_software_common_request: {
                /** @description 将包含所需字段（ccode cname等）的对象序列化成json字符串 */
                data_json: string;
                /** @description 是否为测试数据 */
                for_test?: boolean;
            };
        };
        /** alibaba.icbu.snsoft.account.bill.sync response */
        AlibabaTradeAlibabaIcbuSnsoftAccountBillSyncResponse: {
            /** @description 返回结果 */
            result?: {
                /** @description 是否成功 */
                success?: boolean;
                /** @description 错误码 */
                error_code?: string;
                /** @description 错误信息 */
                error_msg?: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.snsoft.customer.sync request */
        AlibabaTradeAlibabaIcbuSnsoftCustomerSyncRequest: {
            /** @description 请求参数 */
            south_north_software_common_request: {
                /** @description 将包含所需字段（ccode cname等）的对象序列化成json字符串 */
                data_json: string;
                /** @description 是否为测试数据 */
                for_test?: boolean;
            };
        };
        /** alibaba.icbu.snsoft.customer.sync response */
        AlibabaTradeAlibabaIcbuSnsoftCustomerSyncResponse: {
            /** @description 返回结果 */
            result?: {
                /** @description 是否成功 */
                success?: boolean;
                /** @description 错误码 */
                error_code?: string;
                /** @description 错误信息 */
                error_msg?: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.snsoft.sale.order.detail.sync request */
        AlibabaTradeAlibabaIcbuSnsoftSaleOrderDetailSyncRequest: {
            /** @description 请求参数 */
            south_north_software_common_request: {
                /** @description 将包含所需字段（ccode cname等）的对象序列化成json字符串 */
                data_json: string;
                /** @description 是否为测试数据 */
                for_test?: boolean;
            };
        };
        /** alibaba.icbu.snsoft.sale.order.detail.sync response */
        AlibabaTradeAlibabaIcbuSnsoftSaleOrderDetailSyncResponse: {
            /** @description 返回结果 */
            result?: {
                /** @description 是否成功 */
                success?: boolean;
                /** @description 错误码 */
                error_code?: string;
                /** @description 错误信息 */
                error_msg?: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.snsoft.shipment.finalaccount.sync request */
        AlibabaTradeAlibabaIcbuSnsoftShipmentFinalaccountSyncRequest: {
            /** @description 请求参数 */
            south_north_software_common_request: {
                /** @description 是否为测试数据 */
                for_test?: boolean;
                /** @description 将包含所需字段（ccode cname等）的对象序列化成json字符串 */
                data_json: string;
            };
        };
        /** alibaba.icbu.snsoft.shipment.finalaccount.sync response */
        AlibabaTradeAlibabaIcbuSnsoftShipmentFinalaccountSyncResponse: {
            /** @description 返回结果 */
            result?: {
                /** @description 是否成功 */
                success?: boolean;
                /** @description 错误码 */
                error_code?: string;
                /** @description 错误信息 */
                error_msg?: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.icbu.xiaoman.va.list request */
        AlibabaTradeAlibabaIcbuXiaomanVaListRequest: {
            /** @description 卖家accountId */
            user_id: string;
            /** @description context */
            context?: string;
            /** @description idempotent_id */
            idempotent_id?: string;
        };
        /** alibaba.icbu.xiaoman.va.list response */
        AlibabaTradeAlibabaIcbuXiaomanVaListResponse: {
            /** @description 结果集 */
            data?: {
                /** @description va列表 */
                va_list?: {
                    /** @description 账户名 */
                    account_name?: string;
                    /** @description 账号 */
                    account_no?: string;
                    /** @description 地区 */
                    area?: string;
                    /** @description 是否是本地 */
                    global?: boolean;
                    /** @description 创建时间 */
                    gmt_create?: number | string;
                    /** @description 修改时间 */
                    gmt_modified?: number | string;
                    /** @description 商户 */
                    merchant?: string;
                    /** @description 开通日期 */
                    open_date?: string;
                    /** @description 状态 */
                    status?: string;
                    /** @description beneficiary_bank_name */
                    beneficiary_bank_name?: string;
                    /** @description beneficiaryAccountInfo */
                    beneficiary_bank_address?: string;
                    /** @description beneficiary_bank_swift_code */
                    beneficiary_bank_swift_code?: string;
                    /** @description beneficiary_country */
                    beneficiary_country?: string;
                    /** @description currency */
                    currency?: string;
                    /** @description country */
                    country?: string;
                    /** @description beneficiaryAddress */
                    beneficiary_address?: string;
                    /** @description routingNo */
                    routing_no?: string;
                    /** @description beneficiaryBankCode */
                    beneficiary_bank_code?: string;
                    /** @description beneficiaryBankBranchCode */
                    beneficiary_bank_branch_code?: string;
                }[];
            };
            /** @description 是否成功 */
            successful?: boolean;
            /** @description 错误码 */
            errcode?: string;
            /** @description 消息 */
            message?: string;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.intention.order.save request */
        AlibabaTradeAlibabaIntentionOrderSaveRequest: {
            /** @description 意向单结构 */
            intention_order?: {
                /** @description 买家传真号码 */
                buyer_fax?: string;
                /** @description 买家电话号码 */
                buyer_telephone?: string;
                /** @description 买家电邮地址 */
                buyer_email?: string;
                /** @description 订单备注 */
                remark?: string;
                /** @description 贸易条款 */
                trade_term?: string;
                /** @description 买家邮编 */
                buyer_zip_code?: string;
                /** @description 订单总价 */
                order_amount?: string;
                /** @description 买家城市 */
                buyer_city?: string;
                /** @description 意向单物流结构 */
                intention_order_logistics?: {
                    /** @description 物流费 */
                    shipment_fee?: string;
                    /** @description 收货国家 */
                    country?: string;
                    /** @description 收货城市 */
                    city?: string;
                    /** @description 收货城市代码 */
                    city_code?: string;
                    /** @description 收货人 */
                    contact_person?: string;
                    /** @description 发货港 */
                    departure_port?: string;
                    /** @description * 发货日期类型：绝对时间/预付款收齐/尾款收齐 * 枚举值：absolute/relative/relative_balance; */
                    delivery_date_type?: string;
                    /** @description 物流地址ID（根据国际站的物流地址ID保持一致） */
                    address_id?: string;
                    /** @description * 发货时间，适用于预付款收齐后多少天发货、尾款收齐后多少天发货两种发货类型</br>      * 单位：天 */
                    delivery_date_relative_duration?: number;
                    /** @description 运输方式 */
                    shipment_method?: string;
                    /** @description 收货省/州 */
                    province?: string;
                    /** @description 发货城市代码 */
                    departure_city_code?: string;
                    /** @description 收货国家代码 */
                    country_code?: string;
                    /** @description 绝对发货时间 ，格式传 "yyyy-MM-dd HH:mm:ss" */
                    delivery_date_absolute_time?: string;
                    /** @description 收货人传真结构 */
                    fax?: {
                        /** @description 收货人传真区域号码 */
                        area?: string;
                        /** @description 收货人传真国家号码 */
                        country?: string;
                        /** @description 收货人传真号码 */
                        number?: string;
                    };
                    /** @description 发货港口代码 */
                    departure_port_code?: string;
                    /** @description 收货人邮编 */
                    zip?: string;
                    /** @description 收货详细地址 */
                    address?: string;
                    /** @description 发货城市 */
                    departure_city?: string;
                    /** @description 收货人省/州代码 */
                    province_code?: string;
                    /** @description 收货人移动电话结构 */
                    mobile?: {
                        /** @description 收货人移动电话区域号码 */
                        area?: string;
                        /** @description 收货人移动电话国家号码 */
                        country?: string;
                        /** @description 收货人移动电话号码 */
                        number?: string;
                    };
                    /** @description 收货人电话结构 */
                    telephone?: {
                        /** @description 收货人电话区域号码 */
                        area?: string;
                        /** @description 收货人电话国家号码 */
                        country?: string;
                        /** @description 收货人电话号码 */
                        number?: string;
                    };
                    /** @description 收货人港口代码 */
                    port_code?: string;
                    /** @description 承运商 */
                    carrier?: string;
                    /** @description 收货人港口名称 */
                    port?: string;
                    /** @description 承运商代码 */
                    carrier_code?: string;
                    /** @description 收货人备份详细地址 */
                    alternate_address?: string;
                    /** @description 物流扩展属性 */
                    properties?: string;
                };
                /** @description 交易货币类型 */
                currency?: string;
                /** @description 渠道订单ID */
                source_channel_refer_id?: string;
                /** @description 买家省/州 */
                buyer_province?: string;
                /** @description 买家联系地址 */
                buyer_contact_address?: string;
                /** @description 买家收货港口名称 */
                buyer_country_port?: string;
                /** @description 意向单商品结构 */
                intention_order_products?: {
                    /** @description 商品描述 */
                    product_desc?: string;
                    /** @description 商品规格描述 */
                    product_spec?: string;
                    /** @description SKU ID,跟国际站SKU ID保持一致 */
                    sku_id?: string;
                    /** @description 商品数量 */
                    quantity?: string;
                    /** @description 商品原始单价 */
                    original_unit_price?: string;
                    /** @description 商品单价 */
                    unit_price?: string;
                    /** @description 商品单位 */
                    unit?: string;
                    /** @description 商品图片地址URL，先调用API（alibaba.order.picture.upload）上传图片 */
                    image_url?: string;
                    /** @description 商品类型 */
                    type?: string;
                    /** @description 商品名称 */
                    name?: string;
                    /** @description 商品ID，跟国际站商品ID保持一致 */
                    product_id?: number;
                    /** @description 商品扩展属性 */
                    properties?: string;
                }[];
                /** @description 买家收货港口代码 */
                buyer_country_port_code?: string;
                /** @description 意向单ID，如果是创建意向单不需要填写 */
                intention_order_id?: string;
                /** @description 买家名称 */
                buyer_name?: string;
                /** @description 买家公司名称 */
                buyer_company_name?: string;
                /** @description 买家国家代码 */
                buyer_country_code?: string;
                /** @description 买家国家 */
                buyer_country?: string;
                /** @description 预付款金额 */
                advanced_amount?: string;
                /** @description 买家省/州代码 */
                buyer_province_code?: string;
                /** @description 买家城市代码 */
                buyer_city_code?: string;
                /** @description 买家移动电话 */
                buyer_mobile?: string;
                /** @description 订单扩展属性 */
                properties?: string;
                /** @description 订单状态<br />DRAFT/APPROACHED/BUYER_CONFIRMED/CONFIRMED/CANCELLED：起草意向单/已和买家联系/买家已确认/双方确定/已取消 */
                status?: string;
            };
        };
        /** alibaba.intention.order.save response */
        AlibabaTradeAlibabaIntentionOrderSaveResponse: {
            /** @description 返回值接口 */
            value?: {
                /** @description 意向单ID */
                intention_id?: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.order.trade.tt.get request */
        AlibabaTradeAlibabaOrderTradeTtGetRequest: {
            /** @description 订单号 */
            e_trade_id: string;
        };
        /** alibaba.order.trade.tt.get response */
        AlibabaTradeAlibabaOrderTradeTtGetResponse: {
            /** @description 对象 */
            value?: {
                /** @description 当前需要支付的金额 */
                pay_amount?: {
                    /** @description 金额 */
                    amount?: string;
                    /** @description 币种 */
                    currency?: string;
                };
                /** @description 国际tt账号 */
                default_tt_account?: {
                    /** @description 收款人银行账号 */
                    beneficiary_account_no?: string;
                    /** @description 银行代码 */
                    bank_code?: string;
                    /** @description 收款人银行名称 */
                    beneficiary_bank?: string;
                    /** @description 受益目的国 */
                    destination?: string;
                    /** @description 收款银行地址 */
                    beneficiary_bank_address?: string;
                    /** @description 收款人地址 */
                    beneficiary_address?: string;
                    /** @description 支付手续费 */
                    payment_transaction_fee?: string;
                    /** @description 分行代码 */
                    branch_code?: string;
                    /** @description 收款人名称 */
                    beneficiary_name?: string;
                    /** @description 币种 */
                    currency?: string;
                    /** @description 收款银行Swift编码 */
                    beneficiary_bank_swift_code?: string;
                    /** @description 预计到账时长 */
                    estimated_payment_receipt?: string;
                };
                /** @description {} */
                us_tt_account?: {
                    /** @description 收款人银行账号 */
                    beneficiary_account_no?: string;
                    /** @description 银行代码 */
                    bank_code?: string;
                    /** @description 收款人银行名称 */
                    beneficiary_bank?: string;
                    /** @description 受益目的国 */
                    destination?: string;
                    /** @description 收款银行地址 */
                    beneficiary_bank_address?: string;
                    /** @description 收款人地址 */
                    beneficiary_address?: string;
                    /** @description 支付手续费 */
                    payment_transaction_fee?: string;
                    /** @description 分行代码 */
                    branch_code?: string;
                    /** @description 收款人名称 */
                    beneficiary_name?: string;
                    /** @description 币种 */
                    currency?: string;
                    /** @description 收款银行Swift编码 */
                    beneficiary_bank_swift_code?: string;
                    /** @description 预计到账时长 */
                    estimated_payment_receipt?: string;
                    /** @description 美国银行协会（ABA）代码/汇款路线代码 */
                    aba_no?: string;
                    /** @description ACH支付代码,美国独有 */
                    ach_payment_code?: string;
                };
                /** @description 引导文案 */
                guide_content?: string;
                /** @description 备注 */
                remark?: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.seller.address.save request */
        AlibabaTradeAlibabaSellerAddressSaveRequest: {
            /** @description {} */
            param_trade_ecology_address_save_request: {
                /** @description 地址 */
                address: {
                    /** @description 主地址 */
                    address: string;
                    /** @description 备用地址 */
                    address2?: string;
                    /** @description 城市 */
                    city: {
                        /** @description 城市名 */
                        name: string;
                    };
                    /** @description 国家 */
                    country: {
                        /** @description 国家名 */
                        name: string;
                        /** @description 国家code */
                        code: string;
                    };
                    /** @description 省 */
                    province: {
                        /** @description 省名 */
                        name: string;
                    };
                    /** @description 邮编 */
                    zip?: string;
                };
                /** @description 地址id，不传则创建一个新的，传了的话就更新该地址 */
                address_id?: string;
                /** @description 买家邮箱 */
                buyer_email: string;
                /** @description 联系人 */
                contact: {
                    /** @description 号码 */
                    mobile_no?: string;
                    /** @description 区号 */
                    phone_code?: string;
                };
                /** @description 联系人 */
                contact_person: string;
            };
        };
        /** alibaba.seller.address.save response */
        AlibabaTradeAlibabaSellerAddressSaveResponse: {
            /** @description {} */
            value?: {
                /** @description 地址id */
                address_id?: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.seller.assurance.credit.card request */
        AlibabaTradeAlibabaSellerAssuranceCreditCardRequest: Record<string, never>;
        /** alibaba.seller.assurance.credit.card response */
        AlibabaTradeAlibabaSellerAssuranceCreditCardResponse: {
            /** @description 请注意是json数组 的 jsonstring 字符串 */
            value?: string;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.seller.auth.extend request */
        AlibabaTradeAlibabaSellerAuthExtendRequest: Record<string, never>;
        /** alibaba.seller.auth.extend response */
        AlibabaTradeAlibabaSellerAuthExtendResponse: {
            /** @description 过期时间 */
            expire_time?: number;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.seller.order.fund.get request */
        AlibabaTradeAlibabaSellerOrderFundGetRequest: {
            /** @description 订单号 */
            e_trade_id: string;
            /** @description 不传默认查询fund_serviceFee和fund_fundPay <br />fund_refund 退款信息 <br />fund_serviceFee 订单的服务费<br />fund_fundPay 预付款和尾款的支付信息 <br /> 多个参数英文逗号分隔即可 */
            data_select?: string;
        };
        /** alibaba.seller.order.fund.get response */
        AlibabaTradeAlibabaSellerOrderFundGetResponse: {
            /** @description 资金信息 */
            value?: {
                /** @description 支付信息列表(包含预付款和尾款) */
                fund_pay_list?: {
                    /** @description 支付金额 */
                    pay_amount?: {
                        /** @description 金额 */
                        amount?: string;
                        /** @description 币种 */
                        currency?: string;
                    };
                    /** @description 支付方式(TT, CREDIT_CARD, E_CHECKING, OTHER, LC, BOLETO;) */
                    pay_method?: string;
                    /** @description 支付状态:<br /> UNPAY //未支付<br /> PAYING,    //买家支付中，主要是包含验证的过程<br /> PAID,      //买家支付完成，对应批发是支付成功<br /> CAPTURED,  //请款完成，到这步就代表资金会到账，对应批发是审核成功<br /> RELATING,  //关联中，挂帐就会进入此状态<br /> FULFILLED, //已完成，代表这个支付单已经收齐（自动收齐或者手动收齐）<br /> FAILED,    //支付失败，可以重新进行支付<br /> CANCELED,  //支付撤销，可以重新进行支付 <br />     CLOSED;    //支付单被关闭，终态) */
                    pay_status?: string;
                    /** @description 支付阶段(ADVANCE//预付款, BALANCE//尾款) */
                    pay_step?: string;
                    /** @description 支付时间 */
                    pay_time?: {
                        /** @description 格式化后的时间(平台按美西时区会格式化好) */
                        format_date?: string;
                        /** @description 时间戳 */
                        timestamp?: number;
                    };
                    /** @description 到账金额 */
                    receive_amount?: {
                        /** @description 金额 */
                        amount?: string;
                        /** @description 币种 */
                        currency?: string;
                    };
                    /** @description 到账时间 */
                    receive_time?: {
                        /** @description 时间戳 */
                        timestamp?: number;
                        /** @description 格式化后的时间(平台按美西时区会格式化好) */
                        format_date?: string;
                    };
                    /** @description 应付金额 */
                    should_pay_amount?: {
                        /** @description 金额 */
                        amount?: string;
                        /** @description 币种 */
                        currency?: string;
                    };
                    /** @description 支付详细信息列表(包含预付款和尾款) */
                    fund_pay_detail_list?: {
                        /** @description 支付金额 */
                        pay_amount?: {
                            /** @description 金额 */
                            amount?: string;
                            /** @description 币种 */
                            currency?: string;
                        };
                        /** @description 支付时间 */
                        pay_time?: {
                            /** @description 时间戳 */
                            timestamp?: number;
                            /** @description 格式化后的时间(平台按美西时区会格式化好) */
                            format_date?: string;
                        };
                        /** @description 实收金额 */
                        receive_amount?: {
                            /** @description 金额 */
                            amount?: string;
                            /** @description 币种 */
                            currency?: string;
                        };
                        /** @description 到账时间 */
                        receive_time?: {
                            /** @description 时间戳 */
                            timestamp?: number;
                            /** @description 格式化后的时间(平台按美西时区会格式化好) */
                            format_date?: string;
                        };
                        /** @description 支付状态:<br /> UNPAY //未支付<br /> PAYING,    //买家支付中，主要是包含验证的过程<br /> PAID,      //买家支付完成，对应批发是支付成功<br /> CAPTURED,  //请款完成，到这步就代表资金会到账，对应批发是审核成功<br /> RELATING,  //关联中，挂帐就会进入此状态<br /> FULFILLED, //已完成，代表这个支付单已经收齐（自动收齐或者手动收齐）<br /> FAILED,    //支付失败，可以重新进行支付<br /> CANCELED,  //支付撤销，可以重新进行支付 <br />     CLOSED;    //支付单被关闭，终态) */
                        pay_status?: string;
                        /** @description 支付方式(TT, CREDIT_CARD, E_CHECKING, OTHER, LC, BOLETO;) */
                        pay_method?: string;
                        /** @description 支付详细信息主键id */
                        id?: number;
                    }[];
                }[];
                /** @description 预估交易服务费 */
                service_fee?: {
                    /** @description 金额 */
                    amount?: string;
                    /** @description 币种 */
                    currency?: string;
                };
                /** @description 已成功退款的信息 */
                refund_list?: {
                    /** @description 退款金额 */
                    amount?: {
                        /** @description 币种 */
                        currency?: string;
                        /** @description 金额 */
                        amount?: string;
                    };
                    /** @description 退款最后更新时间 */
                    refund_time?: {
                        /** @description 时间戳 */
                        timestamp?: number;
                        /** @description 格式化后的时间(平台按美西时区会格式化好) */
                        format_date?: string;
                    };
                    /** @description 退款id */
                    id?: number;
                }[];
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.seller.order.list request */
        AlibabaTradeAlibabaSellerOrderListRequest: {
            /** @description 请求参数对象 */
            param_trade_ecology_order_list_query: {
                /** @description 已经过时,请使用create_date_start */
                create_date_from?: number | string;
                /** @description 已经过时,请使用create_date_end */
                create_date_to?: number | string;
                /** @description 交易对方登录账号(对卖家来说，就是买家登录账号) */
                other_login_id?: string;
                /** @description 每页数量，最大限制100 */
                page_size?: number;
                /** @description 角色(seller,buyer) */
                role: string;
                /** @description 业务员登录账号 */
                sales_man_login_id?: string;
                /** @description 分页起始页，从0开始 */
                start_page?: number;
                /** @description 订单状态( /** * 待付预付款 *\/ unpay, /** * 买家支付中，主要是包含验证的过程 *\/ paying, /** * 买家支付完成，对应批发是支付成功 *\/ paid, /** * 关联中，挂帐就会进入此状态 *\/ relating, /** * 请款完成，到这步就代表资金会到账，对应批发是审核成功 *\/ captured, /** * 待卖家发货 *\/ undeliver, /** * 发货中 *\/ delivering, /** * 待确认收货 *\/ wait_confirm_receipt, /** * 意向订单，待起草信用保障订单 *\/ intention_processing, /** * 交易关闭，取消 *\/ trade_close, /** * 交易成功，完成 *\/ trade_success, /** * 待确认修改合同 *\/ wait_confirm_modify, /** * 交易不可用 *\/ trade_unavailable, /** * 拒付 *\/ charge_back, /** * 冻结中（暂时没区分） *\/ frozen) */
                status?: string;
                /** @description 创建时间开始,美国时间 */
                create_date_start?: {
                    /** @description 格式化时间(yyyy-MM-dd HH:mm:ss) */
                    date_str?: string;
                    /** @description 时间戳 */
                    time?: number;
                };
                /** @description 创建时间结束, 美国时间 */
                create_date_end?: {
                    /** @description 格式化时间(yyyy-MM-dd HH:mm:ss) */
                    date_str?: string;
                    /** @description 时间戳 */
                    time?: number;
                };
                /** @description 修改时间开始,美国时间 */
                modified_date_start?: {
                    /** @description 格式化时间(yyyy-MM-dd HH:mm:ss) */
                    date_str?: string;
                    /** @description 时间戳 */
                    time?: number;
                };
                /** @description 修改时间结束,美国时间 */
                modified_date_end?: {
                    /** @description 格式化时间(yyyy-MM-dd HH:mm:ss) */
                    date_str?: string;
                    /** @description 时间戳 */
                    time?: number;
                };
            };
        };
        /** alibaba.seller.order.list response */
        AlibabaTradeAlibabaSellerOrderListResponse: {
            /** @description 返回结果 */
            result?: {
                /** @description 错误码 */
                error_code?: string;
                /** @description 错误信息提示 */
                error_message?: string;
                /** @description 是否成功 */
                success?: boolean;
                /** @description 列表对象 */
                value?: {
                    /** @description 订单对象 */
                    order_list?: {
                        /** @description 订单号 */
                        trade_id?: string;
                        /** @description 创建时间(美国时间) */
                        create_date?: {
                            /** @description 时间戳 */
                            timestamp?: number;
                            /** @description 格式化时间 MMM. d, yyyy, HH:mm:ss z. */
                            format_date?: string;
                        };
                        /** @description 修改时间(美国时间) */
                        modify_date?: {
                            /** @description 时间戳 */
                            timestamp?: number;
                            /** @description 格式化时间 MMM. d, yyyy, HH:mm:ss z. */
                            format_date?: string;
                        };
                    }[];
                    /** @description 总记录数 */
                    total_count?: number;
                };
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.seller.order.logistics.get request */
        AlibabaTradeAlibabaSellerOrderLogisticsGetRequest: {
            /** @description 订单号 */
            e_trade_id: string;
            /** @description logistic_order 是否查物流单 */
            data_select?: string;
        };
        /** alibaba.seller.order.logistics.get response */
        AlibabaTradeAlibabaSellerOrderLogisticsGetResponse: {
            /** @description 物流信息 */
            value?: {
                /** @description 约定发货时间(相对时间在支付后可以计算出来) */
                agreed_shipment_date?: {
                    /** @description 格式化后的时间(平台按美西时区会格式化好) */
                    format_date?: string;
                    /** @description 时间戳 */
                    timestamp?: number;
                };
                /** @description 发货状态:<br /> UNDELIVERED 未发货,<br /> DELIVERING 发货中,<br /> PART_DELIVERED 部分发货,<br /> DELIVERED 已发货,<br /> CONFIRM_RECEIPT 已确认收货 */
                logistic_status?: string;
                /** @description 实际发货时间 */
                shipment_date?: {
                    /** @description 格式化后的时间(平台按美西时区会格式化好) */
                    format_date?: string;
                    /** @description 时间戳 */
                    timestamp?: number;
                };
                /** @description 物流订单列表 */
                shipping_order_list?: {
                    /** @description 货品列表 */
                    goods?: {
                        /** @description 商品ID */
                        product_id?: string;
                        /** @description 商品数量 */
                        quantity?: string;
                    }[];
                    /** @description 物流凭证信息 */
                    voucher?: {
                        /** @description 物流类型 */
                        logistics_type?: string;
                        /** @description 物流承运商名称 */
                        service_provider?: string;
                        /** @description 物流订单编号 */
                        tracking_number?: string;
                    };
                }[];
                /** @description 物流tracking url */
                tracking_url?: string;
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.seller.trade.decode request */
        AlibabaTradeAlibabaSellerTradeDecodeRequest: {
            /** @description 密文 */
            encryptor_id: string;
        };
        /** alibaba.seller.trade.decode response */
        AlibabaTradeAlibabaSellerTradeDecodeResponse: {
            /** @description 明文 */
            value?: number;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.seller.trade.query.drafttype request */
        AlibabaTradeAlibabaSellerTradeQueryDrafttypeRequest: Record<string, never>;
        /** alibaba.seller.trade.query.drafttype response */
        AlibabaTradeAlibabaSellerTradeQueryDrafttypeResponse: {
            /** @description 该卖家 支持的订单起草类型 */
            types?: string[];
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.trade.address.delete request */
        AlibabaTradeAlibabaTradeAddressDeleteRequest: {
            /** @description 地址id(就是addressId) */
            address_id: number;
        };
        /** alibaba.trade.address.delete response */
        AlibabaTradeAlibabaTradeAddressDeleteResponse: {
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.trade.address.form.save request */
        AlibabaTradeAlibabaTradeAddressFormSaveRequest: {
            /** @description 地址请求对象 */
            contact_address: {
                /** @description 地址 */
                address: {
                    /** @description 地址行1 */
                    address: string;
                    /** @description 地址行2 */
                    address2?: string;
                    /** @description 城市 */
                    city: {
                        /** @description 城市code */
                        code?: string;
                        /** @description 城市名称 */
                        name: string;
                    };
                    /** @description 国家 */
                    country: {
                        /** @description 国家code */
                        code: string;
                        /** @description 国家名称 */
                        name: string;
                    };
                    /** @description 省 */
                    province: {
                        /** @description 省code */
                        code?: string;
                        /** @description 省iso */
                        iso?: string;
                        /** @description 省名称 */
                        name: string;
                    };
                    /** @description 邮编 */
                    zip: string;
                };
                /** @description 买家邮箱 */
                buyer_email: string;
                /** @description 联系方式(邮箱、电话号码、手机号码等). */
                contact: {
                    /** @description 手机号码 */
                    mobile_no: string;
                    /** @description 电话国家区号 */
                    phone_code: string;
                };
                /** @description 联系人 */
                contact_person: string;
                /** @description 地址id，创建的时候不传，更新的时候需要传 */
                address_id?: number;
                /** @description 是否要设置为默认地址 */
                is_default?: boolean;
            };
        };
        /** alibaba.trade.address.form.save response */
        AlibabaTradeAlibabaTradeAddressFormSaveResponse: {
            /** @description 地址id */
            address_id?: number;
            /** @description 地址快照id */
            snapshot_id?: string;
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.trade.address.get request */
        AlibabaTradeAlibabaTradeAddressGetRequest: {
            /** @description {} */
            address_request?: {
                /** @description 此参数 有时候是必传的，请仔细看下面type的解释 */
                param?: string;
                /** @description 1. 指定type=countryList 时，代表查询国家列表，param 可不传 <br /> 2. 指定type=countryIso时，代表查询某个国家下面的省份列表，此时param必传，传国家 iso 字段 <br /> 3. 指定type=provinceId时，代表查询某个省份下面的城市列表，此时param必传，传省份 id 字段 */
                type: string;
            };
        };
        /** alibaba.trade.address.get response */
        AlibabaTradeAlibabaTradeAddressGetResponse: {
            /** @description 对象 */
            value?: {
                /** @description 国家列表 */
                country_entities?: {
                    /** @description 国家码 */
                    iso?: string;
                    /** @description 国家图标 */
                    country_flag?: string;
                    /** @description 国家英文名 */
                    name?: string;
                }[];
                /** @description 省份 */
                provinces?: {
                    /** @description 省份英文名 */
                    name?: string;
                    /** @description 省份id (也就是code) */
                    id?: number;
                    /** @description 所属国家名 */
                    country_name?: string;
                    /** @description 省iso */
                    iso?: string;
                }[];
                /** @description 城市列表 */
                cities?: {
                    /** @description 城市英文名 */
                    name?: string;
                    /** @description 所属省份id */
                    province_id?: number;
                    /** @description 城市id(就是code) */
                    id?: string;
                }[];
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.trade.address.list.query request */
        AlibabaTradeAlibabaTradeAddressListQueryRequest: {
            /** @description 买家邮箱 */
            buyer_email: string;
        };
        /** alibaba.trade.address.list.query response */
        AlibabaTradeAlibabaTradeAddressListQueryResponse: {
            /** @description value */
            value?: {
                /** @description 修改时间 */
                gmt_modified?: number | string;
                /** @description 联系人 */
                contact_person?: string;
                /** @description 联系方式 */
                contact?: {
                    /** @description 电话国家号码 */
                    phone_code?: string;
                    /** @description 电话号码 */
                    mobile_no?: string;
                };
                /** @description 地址id */
                address_id?: number;
                /** @description 地址明细 */
                address?: {
                    /** @description 邮编 */
                    zip?: string;
                    /** @description 国家 */
                    country?: {
                        /** @description 国家code */
                        code?: string;
                        /** @description 国家name */
                        name?: string;
                    };
                    /** @description address行1 */
                    address?: string;
                    /** @description address行2 */
                    address2?: string;
                    /** @description 城市 */
                    city?: {
                        /** @description 城市code */
                        code?: string;
                        /** @description 城市name */
                        name?: string;
                    };
                    /** @description 省 */
                    province?: {
                        /** @description 省code */
                        code?: string;
                        /** @description 省iso */
                        iso?: string;
                        /** @description 省name */
                        name?: string;
                    };
                };
                /** @description 地址快照id */
                snapshot_id?: string;
                /** @description 地址创建时间 */
                gmt_create?: number | string;
                /** @description 是否默认地址 */
                is_default?: boolean;
            }[];
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.trade.address.schema.query request */
        AlibabaTradeAlibabaTradeAddressSchemaQueryRequest: {
            /** @description 地址表单查询参数对象 */
            param_address_localization_form_query: {
                /** @description 目的国 */
                dest_country_code: string;
                /** @description en_US,zh_CN,zh_TW */
                language?: string;
            };
        };
        /** alibaba.trade.address.schema.query response */
        AlibabaTradeAlibabaTradeAddressSchemaQueryResponse: {
            /** @description 表单 */
            forms?: {
                /** @description 国家code */
                country_code?: string;
                /** @description 国家是否被禁用 */
                disabled?: boolean;
                /** @description 是否开启联想能力 */
                enable_association?: boolean;
                /** @description 是否开启多语言输入 */
                enable_multi_lang_input?: boolean;
                /** @description 开启邮编联想 */
                enable_post_code_search?: boolean;
                /** @description 开启智能解析模块 */
                enable_smart_fill?: boolean;
                /** @description 表单字段规则 */
                form_fields?: {
                    /** @description * 字段常驻提示      * 默认的只会返回 Select      * 如果需要 Enter，前端需要根据当前是否返回数据动态判断 */
                    field_hint?: string;
                    /** @description 字段悬浮提示 */
                    field_hover_tip?: string;
                    /** @description 手机号 contact.mobileNo,完整姓名 contact.fullName,国家 address.country,州省 address.province,城市 address.city,地址行1 address.address1,地址行2 address.address2,邮编 address.postCode */
                    field_key?: string;
                    /** @description 字段展示名 */
                    field_label?: string;
                    /** @description 字段底纹提示 */
                    field_placeholder?: string;
                    /** @description 字段填写方式input,drop_down */
                    fill_type?: string;
                    /** @description 顺序 */
                    order?: number;
                    /** @description 规则 */
                    rule?: {
                        /** @description 是否校验正则 */
                        check_reg_exp?: boolean;
                        /** @description * 正则表达式      * checkRegExp 为 true 时有效 */
                        reg_exps?: {
                            /** @description * 行间展示：失败了展示的文案      * （内容是动态的，会有动态的参数绑定） */
                            check_failed_tips_text?: string;
                            /** @description 正则表达式 */
                            reg_exp?: string;
                            /** @description regKey=fieldKey + regExpName */
                            reg_key?: string;
                        }[];
                        /** @description 是否必填 */
                        require_not_null?: boolean;
                    };
                }[];
                /** @description 表单填写模式 */
                form_fill_mode?: string;
            }[];
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.trade.fulfillment.channel.get request */
        AlibabaTradeAlibabaTradeFulfillmentChannelGetRequest: {
            /** @description 用户语言 */
            language?: string;
        };
        /** alibaba.trade.fulfillment.channel.get response */
        AlibabaTradeAlibabaTradeFulfillmentChannelGetResponse: {
            /** @description 返回结果 */
            result?: {
                /** @description 错误码 */
                error_code?: string;
                /** @description 错误原因 */
                error_message?: string;
                /** @description 是否成功 */
                success?: boolean;
                /** @description 返回结果 */
                value?: {
                    /** @description 小单限额 */
                    tad_order_amount_limit?: string;
                    /** @description 返回的支持的履约通道 */
                    support_fulfillment_channels?: {
                        /** @description 一达通 */
                        name?: string;
                        /** @description 可用 */
                        enable?: boolean;
                        /** @description 不可用的原因码 */
                        code?: string;
                        /** @description 不可用的具体原因 */
                        message?: string;
                    }[];
                    /** @description 小单限额的币种 */
                    currency?: string;
                };
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.trade.order.create request */
        AlibabaTradeAlibabaTradeOrderCreateRequest: {
            /** @description 订单创建参数 */
            param_order_create: {
                /** @description 物流详情 */
                logistics_detail: {
                    /** @description 收货地址 */
                    shipment_address: {
                        /** @description 邮政编码 */
                        zip?: string;
                        /** @description 国家信息 */
                        country: string;
                        /** @description 地址详情 */
                        address: string;
                        /** @description 城市 */
                        city: string;
                        /** @description 省份 */
                        province_code?: string;
                        /** @description 城市编码 */
                        city_code?: string;
                        /** @description 联系人 */
                        contact_person: string;
                        /** @description 联系电话 */
                        telephone: {
                            /** @description 区号 */
                            area?: string;
                            /** @description 国家区域号 */
                            country?: string;
                            /** @description 电话号码 */
                            number?: string;
                        };
                        /** @description 港口号 */
                        port_code?: string;
                        /** @description 省份 */
                        province?: string;
                        /** @description 港口 */
                        port?: string;
                        /** @description 国家code */
                        country_code?: string;
                        /** @description 备选地址 */
                        alternate_address?: string;
                        /** @description 传真 */
                        fax?: {
                            /** @description 区域 */
                            area?: string;
                            /** @description 国家 */
                            country?: string;
                            /** @description 号码 */
                            number?: string;
                        };
                    };
                    /** @description 发货方式，海运，空运，快递等 */
                    shipment_method: string;
                    /** @description 贸易术语 */
                    trade_term: string;
                    /** @description 物流承运商 */
                    carrier?: string;
                    /** @description 物流承运商code */
                    carrier_code?: string;
                    /** @description 发货日期 */
                    shipment_date: {
                        /** @description 预付款或者尾款多少天发货 */
                        duration?: number;
                        /** @description 绝对日期 */
                        date?: {
                            /** @description 格式化时间 */
                            format_date?: string;
                            /** @description 时间戳 */
                            time_stamp?: number;
                        };
                        /** @description relative 相对预付款几天<br /> relative_balance 相对尾款几天<br /> absolute 绝对时间 如 2019-01-01 */
                        type?: string;
                    };
                };
                /** @description 履约通道 */
                fulfillment_channel?: string;
                /** @description 支付详情 */
                payment_detail: {
                    /** @description 物流费用 */
                    shipment_fee: string;
                    /** @description 订单总金额 */
                    total_amount: string;
                    /** @description 产品总金额 */
                    product_amount: string;
                    /** @description 物流保险费用 */
                    shipment_insurance_fee: string;
                    /** @description 预付款金额 */
                    initial_amount: string;
                    /** @description 增值服务费用 */
                    value_add_service_amount?: string;
                    /** @description 税费金额 */
                    tax_amount?: string;
                    /** @description 币种 */
                    currency?: string;
                };
                /** @description 第三方软件渠道 */
                third_party_channel?: string;
                /** @description 交易对方信息 */
                target_participant: {
                    /** @description 阿里登录id */
                    login_id?: string;
                    /** @description 邮箱地址 */
                    email?: string;
                };
                /** @description 订单备注 */
                remark?: string;
                /** @description 产品列表 */
                product_list: {
                    /** @description 产品id */
                    product_id?: number;
                    /** @description 产品名称 */
                    name: string;
                    /** @description skuId */
                    sku_id: string;
                    /** @description 产品单位 */
                    unit: string;
                    /** @description 购买个数 */
                    quantity: string;
                    /** @description 购买单价 */
                    unit_price_str: string;
                    /** @description 币种 */
                    currency?: string;
                    /** @description 加密的产品ID */
                    encrypt_product_id: string;
                    /** @description 产品图片地址 */
                    product_image?: string;
                }[];
                /** @description 扩展属性 */
                properties?: string;
                /** @description 业务身份 */
                biz_code: string;
                /** @description 当前操作者邮箱 */
                operator_email?: string;
            };
        };
        /** alibaba.trade.order.create response */
        AlibabaTradeAlibabaTradeOrderCreateResponse: {
            /** @description 返回结果 */
            result?: {
                /** @description 是否成功 */
                success: boolean;
                /** @description 错误信息 */
                error_message: string;
                /** @description 错误code */
                error_code: string;
                /** @description 创建订单结果 */
                value: {
                    /** @description 订单id */
                    trade_id: string;
                    /** @description 支付链接 */
                    pay_url: string;
                };
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.trade.order.modify request */
        AlibabaTradeAlibabaTradeOrderModifyRequest: {
            /** @description 订单修改参数 */
            param_order_modify: {
                /** @description 订单ID */
                trade_id: string;
                /** @description 物流详情 */
                logistics_detail: {
                    /** @description 发货地址 */
                    shipment_address: {
                        /** @description 邮政编码 */
                        zip: string;
                        /** @description 国家信息 */
                        country: string;
                        /** @description 收货地址详情 */
                        address: string;
                        /** @description 城市 */
                        city: string;
                        /** @description 省份 */
                        province_code?: string;
                        /** @description 城市编码 */
                        city_code?: string;
                        /** @description 联系人 */
                        contact_person: string;
                        /** @description 联系电话 */
                        telephone: {
                            /** @description 区号 */
                            area?: string;
                            /** @description 国家码 */
                            country?: string;
                            /** @description 电话号码 */
                            number?: string;
                        };
                        /** @description 传真 */
                        fax?: {
                            /** @description 区域 */
                            area?: string;
                            /** @description 国家 */
                            country?: string;
                            /** @description 传真号码 */
                            number?: string;
                        };
                        /** @description 备选地址 */
                        alternate_address?: string;
                    };
                    /** @description 发货方式，海运，空运，快递等 */
                    shipment_method: string;
                    /** @description 贸易术语 */
                    trade_term: string;
                    /** @description 物流承运商 */
                    carrier?: string;
                    /** @description 物流承运商code */
                    carrier_code?: string;
                    /** @description 发货日期 */
                    shipment_date: {
                        /** @description 预付款或者尾款多少天发货 */
                        duration?: number;
                        /** @description 绝对日期 */
                        date?: {
                            /** @description 绝对发货日期时间 */
                            format_date?: string;
                            /** @description 时间戳 */
                            time_stamp?: number;
                        };
                        /** @description 发货日期类型 */
                        type?: string;
                    };
                    /** @description 履约通道 */
                    fulfillment_channel?: string;
                };
                /** @description 支付详情 */
                payment_detail: {
                    /** @description 物流费用 */
                    shipment_fee: string;
                    /** @description 总金额 */
                    total_amount: string;
                    /** @description 产品金额 */
                    product_amount: string;
                    /** @description 物流保险费 */
                    shipment_insurance_fee?: string;
                    /** @description 预付款 */
                    initial_amount: string;
                    /** @description 增值服务费 */
                    value_add_service_amount?: string;
                    /** @description 税费 */
                    tax_amount?: string;
                    /** @description 币种 */
                    currency?: string;
                };
                /** @description 订单备注 */
                remark?: string;
                /** @description 产品列表 */
                product_list: {
                    /** @description 产品id */
                    product_id?: number;
                    /** @description 产品名称 */
                    name: string;
                    /** @description skuId */
                    sku_id: string;
                    /** @description 产品单位 */
                    unit: string;
                    /** @description 购买数量 */
                    quantity: string;
                    /** @description 产品单价 */
                    unit_price_str: string;
                    /** @description 币种 */
                    currency?: string;
                    /** @description 加密的产品ID */
                    encrypt_product_id?: string;
                }[];
                /** @description 扩展属性 */
                properties?: string;
                /** @description 待修改订单的版本号 */
                version?: string;
            };
        };
        /** alibaba.trade.order.modify response */
        AlibabaTradeAlibabaTradeOrderModifyResponse: {
            /** @description 返回结果 */
            result?: {
                /** @description 是否成功 */
                success: boolean;
                /** @description 错误信息 */
                error_message: string;
                /** @description 错误码 */
                error_code: string;
                /** @description 订单修改结果 */
                value: {
                    /** @description 订单id */
                    trade_id: string;
                    /** @description 支付链接 */
                    pay_url: string;
                };
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        /** alibaba.trade.service.charge.get request */
        AlibabaTradeAlibabaTradeServiceChargeGetRequest: {
            /** @description 交易币种 */
            currency?: string;
        };
        /** alibaba.trade.service.charge.get response */
        AlibabaTradeAlibabaTradeServiceChargeGetResponse: {
            /** @description 返回结果 */
            result?: {
                /** @description 是否成功 */
                success?: boolean;
                /** @description 错误信息 */
                error_message?: string;
                /** @description 错误码 */
                error_code?: string;
                /** @description 返回结果 */
                servcecharge_list?: {
                    /** @description 费率 */
                    ratio?: string;
                    /** @description 服务费最大值 */
                    max_fee?: string;
                    /** @description 一达通服务 */
                    export_service_type?: string;
                    /** @description 使用菜鸟物流 */
                    logistics_type?: string;
                }[];
            };
            /** @description Alibaba 网关返回的请求追踪 ID */
            request_id?: string;
        };
        ApiCapability: {
            method: string;
            domain: string;
            chargeLabel: string;
            /** @enum {string} */
            auth: "required" | "optional" | "none" | "unknown";
            jushitaOnly: boolean;
            restricted: boolean;
            restrictionReason?: string | null;
            enabled: boolean;
            /** Format: uri */
            docUrl: string;
            /** Format: date */
            checkedAt: string;
            /** Format: date */
            updatedAt?: string | null;
            /** @enum {string} */
            source: "catalog" | "article";
            /** @enum {string} */
            lifecycle: "active" | "deprecated" | "unlisted";
            /** @enum {string} */
            risk: "read" | "mutation";
            /** @enum {string} */
            verification: "documented" | "account-verified";
            realCallEnabled: boolean;
            requestSchema?: string | null;
            responseSchema?: string | null;
        };
        ApiFailure: {
            requestId: components["schemas"]["RequestId"];
            /** @constant */
            ok: false;
            error: components["schemas"]["GatewayError"];
        };
        ApiSuccess: {
            requestId: components["schemas"]["RequestId"];
            /** @constant */
            ok: true;
            data: unknown;
        };
        AuthBootstrapRequest: {
            requestId: components["schemas"]["RequestId"];
            bootstrapToken: string;
            username: string;
            password: string;
            remark?: string | null;
        };
        AuthLoginRequest: {
            requestId: components["schemas"]["RequestId"];
            username: string;
            password: string;
        };
        AuthPasswordChangeRequest: {
            requestId: components["schemas"]["RequestId"];
            currentPassword: string;
            newPassword: string;
        };
        BackendMeta: {
            /** @enum {string} */
            runtime: "node" | "cloudflare";
            /** @enum {string} */
            database: "sqlite" | "d1";
            environment: string;
            /** @enum {string} */
            gatewayMode: "mock" | "replay" | "disabled" | "real";
            apiPrefix: string;
            version: string;
        };
        CapabilityCallRequest: {
            method: string;
            parameters: {
                [key: string]: unknown;
            };
        };
        CapabilityCallResult: components["schemas"]["CapabilityResponseEnvelope"];
        CapabilityContractIssue: {
            instancePath: string;
            keyword: string;
            message: string;
        };
        CapabilityDefinition: {
            method: string;
            title: string;
            description: string;
            /** @enum {string} */
            source: "catalog" | "article";
            /** @enum {string} */
            lifecycle: "active" | "deprecated" | "unlisted";
            /** @enum {string} */
            risk: "read" | "mutation";
            /** @enum {string} */
            verification: "documented" | "account-verified";
            realCallEnabled: boolean;
            restricted?: boolean;
            restrictionReason?: string | null;
            featureArea?: string;
            requestSchema: string;
            responseSchema: string;
            requestExample: {
                [key: string]: unknown;
            };
            responseExample: unknown;
            errorCodes: {
                [key: string]: unknown;
            }[];
            /** Format: date */
            checkedAt: string;
            /** Format: date */
            updatedAt?: string | null;
            /** Format: uri */
            docUrl: string;
        };
        CapabilityResponseEnvelope: {
            method: string;
            traceId: string;
            data: components["schemas"]["AlibabaProductAlibabaIcbuCategoryAttrGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryAttributeGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryAttrvalueGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryGetNewResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryIdMappingResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryLevelAttrGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryPostcatGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuCategorySchemaLevelGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuOpenProductPostResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductAddResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductAddDraftResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductBatchUpdateDisplayResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductGroupAddResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductGroupGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductIdDecryptResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductListResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaAddResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaAddDraftResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaRenderResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaRenderDraftResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaUpdateResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductScoreGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductUpdateResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductUpdateFieldResponse"] | components["schemas"]["AlibabaRfqAlibabaIcbuAnnexUploadResponse"] | components["schemas"]["AlibabaRfqAlibabaIcbuQuotationPostResponse"] | components["schemas"]["AlibabaRfqAlibabaIcbuRfqMyequityResponse"] | components["schemas"]["AlibabaRfqAlibabaIcbuRfqReadResponse"] | components["schemas"]["AlibabaRfqAlibabaIcbuRfqRecommendResponse"] | components["schemas"]["AlibabaRfqAlibabaIcbuRfqSearchResponse"] | components["schemas"]["AlibabaRfqAlibabaIcbuRfqdetailGetResponse"] | components["schemas"]["AlibabaTradeAlibabaSellerOrderListResponse"] | components["schemas"]["AlibabaTradeAlibabaSellerOrderFundGetResponse"] | components["schemas"]["AlibabaTradeAlibabaSellerOrderLogisticsGetResponse"] | components["schemas"]["AlibabaTradeAlibabaTradeOrderCreateResponse"] | components["schemas"]["AlibabaTradeAlibabaTradeOrderModifyResponse"] | components["schemas"]["AlibabaTradeAlibabaTradeFulfillmentChannelGetResponse"] | components["schemas"]["AlibabaTradeAlibabaTradeServiceChargeGetResponse"] | components["schemas"]["AlibabaTradeAlibabaSellerAssuranceCreditCardResponse"] | components["schemas"]["AlibabaTradeAlibabaOrderTradeTtGetResponse"] | components["schemas"]["AlibabaTradeAlibabaTradeAddressGetResponse"] | components["schemas"]["AlibabaTradeAlibabaIcbuEcologyWriteResponse"] | components["schemas"]["AlibabaTradeAlibabaIntentionOrderSaveResponse"] | components["schemas"]["AlibabaTradeAlibabaSellerAddressSaveResponse"] | components["schemas"]["AlibabaTradeAlibabaSellerTradeDecodeResponse"] | components["schemas"]["AlibabaTradeAlibabaSellerTradeQueryDrafttypeResponse"] | components["schemas"]["AlibabaTradeAlibabaIcbuSnsoftCustomerSyncResponse"] | components["schemas"]["AlibabaTradeAlibabaIcbuXiaomanVaListResponse"] | components["schemas"]["AlibabaTradeAlibabaIcbuSnsoftSaleOrderDetailSyncResponse"] | components["schemas"]["AlibabaTradeAlibabaIcbuSnsoftAccountBillSyncResponse"] | components["schemas"]["AlibabaTradeAlibabaIcbuSnsoftShipmentFinalaccountSyncResponse"] | components["schemas"]["AlibabaTradeAlibabaIcbuCheckOverseasAdmittanceResponse"] | components["schemas"]["AlibabaTradeAlibabaSellerAuthExtendResponse"] | components["schemas"]["AlibabaTradeAlibabaTradeAddressSchemaQueryResponse"] | components["schemas"]["AlibabaTradeAlibabaTradeAddressFormSaveResponse"] | components["schemas"]["AlibabaTradeAlibabaTradeAddressListQueryResponse"] | components["schemas"]["AlibabaTradeAlibabaTradeAddressDeleteResponse"] | components["schemas"]["AlibabaLogisticsAlibabaOnetouchLogisticsBuyerInfoGetResponse"] | components["schemas"]["AlibabaLogisticsAlibabaOnetouchLogisticsExpressSpecialProductTypeListResponse"] | components["schemas"]["AlibabaLogisticsAlibabaOnetouchLogisticsExpressOrderCancelReasonListResponse"] | components["schemas"]["AlibabaLogisticsAlibabaOnetouchLogisticsExpressChargeCalculateResponse"] | components["schemas"]["AlibabaLogisticsAlibabaOnetouchLogisticsExpressLogisticsRuleValidateResponse"] | components["schemas"]["AlibabaLogisticsAlibabaOnetouchLogisticsExpressOrderCancelResponse"] | components["schemas"]["AlibabaLogisticsAlibabaOnetouchLogisticsExpressLogisticsProductListResponse"] | components["schemas"]["AlibabaLogisticsAlibabaOnetouchLogisticsExpressLogisticsOrderCreateResponse"] | components["schemas"]["AlibabaLogisticsAlibabaOnetouchLogisticsExpressAddressCityListResponse"] | components["schemas"]["AlibabaLogisticsAlibabaOnetouchLogisticsExpressAddressProvinceListResponse"] | components["schemas"]["AlibabaLogisticsAlibabaOnetouchLogisticsExpressAddressDivisionListResponse"] | components["schemas"]["AlibabaLogisticsAlibabaOnetouchLogisticsExpressAddressStreetListResponse"] | components["schemas"]["AlibabaLogisticsAlibabaOnetouchLogisticsExpressOrderDetailGetResponse"] | components["schemas"]["AlibabaLogisticsAlibabaOnetouchLogisticsExpressOrderListQueryResponse"] | components["schemas"]["AlibabaLogisticsAlibabaWholesaleShippinglineTemplateListResponse"] | components["schemas"]["AlibabaInsightsAlibabaIcbuDiagnosticSupplierRankGetpercentResponse"] | components["schemas"]["AlibabaInsightsAlibabaMydataSelfQueryCgsokkResponse"] | components["schemas"]["AlibabaInsightsAlibabaProcurementMysupplierListResponse"] | components["schemas"]["AlibabaInsightsAlibabaProcurementSupplierItemsGetResponse"] | components["schemas"]["AlibabaPhotoAlibabaIcbuPhotobankGroupListResponse"] | components["schemas"]["AlibabaPhotoAlibabaIcbuPhotobankGroupOperateResponse"] | components["schemas"]["AlibabaPhotoAlibabaIcbuPhotobankListResponse"] | components["schemas"]["AlibabaPhotoAlibabaIcbuPhotobankUploadResponse"] | components["schemas"]["AlibabaPlatformAlibabaIcbuFileUrlpostingUploadResponse"] | components["schemas"]["AlibabaPlatformAlibabaIcbuRiskSendResponse"] | components["schemas"]["AlibabaPlatformAlibabaIcbuTaskStatusNotifyResponse"];
            contractValid: boolean;
            contractIssues: components["schemas"]["CapabilityContractIssue"][];
        };
        DashboardSummary: {
            productCount: number | null;
            photoCount: number | null;
            orderCount: number | null;
            enabledCapabilityCount: number;
        };
        DiagnosticEntry: {
            id: string;
            /** Format: date-time */
            timestamp: string;
            operation: string;
            method: string | null;
            /** @enum {string} */
            outcome: "success" | "error";
            durationMs: number;
            errorCode: string | null;
            errorMessage: string | null;
            traceId: string | null;
        };
        DiagnosticsSnapshot: {
            /** Format: date-time */
            generatedAt: string;
            extensionVersion: string;
            entries: components["schemas"]["DiagnosticEntry"][];
        };
        EncodedFilePayload: {
            fileName: string;
            contentBase64: string;
            contentType: string;
            byteLength: number;
        };
        GatewayError: {
            code: string;
            message: string;
            subCode?: string;
            traceId?: string;
            retryable: boolean;
        };
        InsightsSupplierPage: {
            supplierIds: string[];
            page: number;
            pageSize: number;
            total: number;
        };
        InsightsSupplierProduct: {
            id: string;
            subject: string;
            description: string;
            categoryId: string;
            priceRange: string | null;
            priceUnit: string | null;
            /** Format: uri */
            productUrl: string | null;
            publishedAt: string | null;
            attributes: components["schemas"]["InsightsSupplierProductAttribute"][];
        };
        InsightsSupplierProductAttribute: {
            attributeId: string;
            attributeName: string;
            valueId: string;
            valueName: string;
            imageUrl: string | null;
            customValueName: string | null;
        };
        InsightsSupplierProductPage: {
            items: components["schemas"]["InsightsSupplierProduct"][];
            page: number;
            pageSize: number;
            total: number;
        };
        InsightsSupplierRankPoint: {
            statDate: string;
            percent: number;
        };
        InsightsSupplierRankTrend: {
            items: components["schemas"]["InsightsSupplierRankPoint"][];
            latestPercent: number | null;
        };
        LogisticsAddress: {
            countryCode: string;
            provinceCode: string | null;
            cityCode: string | null;
            divisionCode: string | null;
            streetCode: string | null;
            address1: string;
            address2: string | null;
            zipCode: string;
            contact: components["schemas"]["LogisticsContact"];
        };
        LogisticsAddressNode: {
            id: string;
            code: string;
            name: string;
            /** @enum {string} */
            level: "province" | "city" | "division" | "street";
        };
        LogisticsCargo: {
            nameCn: string;
            nameEn: string;
            hsCode: string;
            quantity: string;
            unit: string;
            declarationValue: string;
            currency: string;
            purpose: string;
            material: string;
            productTypeCodes: string[];
        };
        LogisticsContact: {
            contactPerson: string;
            mobileNo: string;
            email: string | null;
            companyName: string | null;
        };
        LogisticsCustoms: {
            declarationAmount: string;
            declarationCurrency: string;
            needCustomsClearance: boolean;
            vatType: string | null;
            vatNumber: string | null;
            taxpayerId: string | null;
            eoriNumber: string | null;
        };
        LogisticsOrderDetail: {
            order: components["schemas"]["LogisticsOrderSummary"];
            warehouseName: string | null;
            warehouseAddress: string | null;
            /** Format: uri */
            labelUrl: string | null;
            labelBase64: string | null;
            trackingNumber: string | null;
        };
        LogisticsOrderDraft: {
            quoteRequest: components["schemas"]["LogisticsQuoteRequest"];
            confirmedProductCode: string;
        };
        LogisticsOrderMutationResult: {
            orderNumber: string;
            success: boolean;
        };
        LogisticsOrderPage: {
            items: components["schemas"]["LogisticsOrderSummary"][];
            page: number;
            pageSize: number;
            total: number;
        };
        LogisticsOrderSummary: {
            orderNumber: string;
            status: string;
            freightAmount: string;
            currency: string;
            /** Format: date-time */
            placedAt: string | null;
        };
        LogisticsPackage: {
            quantity: string;
            lengthCm: string;
            widthCm: string;
            heightCm: string;
            weightKg: string;
            type: string;
        };
        LogisticsProduct: {
            code: string;
            name: string;
            warehouseCode: string | null;
            enabled: boolean;
            unavailableReason: string | null;
        };
        LogisticsQuoteOption: {
            productCode: string;
            productName: string;
            totalAmount: string;
            currency: string;
            estimatedDays: string | null;
            warehouseCode: string | null;
            available: boolean;
            unavailableReason: string | null;
        };
        LogisticsQuoteRequest: {
            originZipCode: string;
            destinationCountryCode: string;
            destinationZipCode: string;
            warehouseCode: string;
            productCode: string;
            cargo: components["schemas"]["LogisticsCargo"][];
            packages: components["schemas"]["LogisticsPackage"][];
            consignor: components["schemas"]["LogisticsAddress"];
            consignee: components["schemas"]["LogisticsAddress"];
            customs: components["schemas"]["LogisticsCustoms"];
            needPickup: boolean;
            supplyChainBizId: string;
            tradeBizId: string | null;
            /** @default ICBU */
            tradePlatform: string;
        };
        LogisticsQuoteResult: {
            options: components["schemas"]["LogisticsQuoteOption"][];
            issues: string[];
        };
        LogisticsSpecialProductType: {
            code: string;
            name: string;
            children: components["schemas"]["LogisticsSpecialProductType"][];
        };
        OperationAvailability: {
            operation: string;
            allowed: boolean;
            reasonCode: string | null;
        };
        OperationAvailabilityRequest: {
            requestId: components["schemas"]["RequestId"];
            operations: string[];
        };
        OperationAvailabilityResult: {
            items: components["schemas"]["OperationAvailability"][];
        };
        OperationCallRequest: {
            requestId: components["schemas"]["RequestId"];
            operation: string;
            payload: {
                [key: string]: unknown;
            };
        };
        Order: {
            id: string;
            buyerName: string;
            amount: number;
            currency: string;
            status: string;
            /** Format: date-time */
            createdAt: string;
            /**
             * @description seller.order.get is not callable outside Jushita.
             * @enum {string}
             */
            detailAvailability: "summary_only";
        };
        OrderFund: {
            orderId: string;
            paidAmount: number;
            currency: string;
            status: string;
        };
        OrderLogistics: {
            orderId: string;
            status: string;
            carrier?: string | null;
            trackingNumber?: string | null;
        };
        OrderPage: components["schemas"]["PageMeta"] & {
            items: components["schemas"]["Order"][];
        };
        PageMeta: {
            page: number;
            pageSize: number;
            total: number;
        };
        PageRequest: {
            requestId: components["schemas"]["RequestId"];
            /** @default 1 */
            page: number;
            /** @default 20 */
            pageSize: number;
        };
        Photo: {
            /** @description Alibaba international PhotoBank fileId; persist it with the Schema value. */
            id: string;
            name: string;
            /** Format: uri */
            url: string;
            groupId: string;
            /** @description Pixel width when known. photobank.list does not return dimensions. */
            width: number | null;
            /** @description Pixel height when known. photobank.list does not return dimensions. */
            height: number | null;
            /** @description Image size in bytes. */
            fileSize: number;
            referenceCount: number;
            /** Format: date-time */
            modifiedAt: string;
        };
        PhotoGroup: {
            id: string;
            name: string;
            photoCount: number;
            parentId: string | null;
            level: number;
        };
        PhotoGroupOperationRequest: {
            /** @enum {string} */
            operation: "add" | "rename" | "delete";
            groupId: string | null;
            groupName: string | null;
        };
        PhotoGroupOperationResult: {
            /** @enum {string} */
            operation: "add" | "rename" | "delete";
            groupId: string;
            group: components["schemas"]["PhotoGroup"] | null;
        };
        PhotoPage: components["schemas"]["PageMeta"] & {
            items: components["schemas"]["Photo"][];
        };
        PhotoTransferRequest: {
            /** Format: uri */
            url: string;
            groupId: string;
            fileName?: string;
            /** @description Optional smaller Schema-derived limit. PhotoBank uploads are capped at 5 MiB. */
            maxBytes?: number;
        };
        PhotoUploadRequest: components["schemas"]["EncodedFilePayload"] & {
            groupId?: string;
        };
        ProbeResponse: {
            requestId: components["schemas"]["RequestId"];
            /** @enum {string} */
            status: "ok" | "not-ready";
        };
        Product: {
            id: string;
            encryptedId: string | null;
            subject: string;
            groupName: string;
            /** @enum {string} */
            status: "online" | "offline" | "draft" | "auditing" | "rejected";
            score: number;
            /** Format: date-time */
            updatedAt: string;
            categoryId: number | null;
        };
        ProductCategory: {
            id: number;
            name: string;
            leaf: boolean;
            children: components["schemas"]["ProductCategory"][];
        };
        ProductCategoryMapping: {
            sourceCategoryId: number;
            targetCategoryId: number;
        };
        ProductDescriptionQualityIssue: {
            code: string;
            /** @enum {string} */
            source: "alibaba-schema" | "official" | "project";
            /** @enum {string} */
            level: "error" | "warning" | "suggestion";
            message: string;
            remediation: string;
            fieldIds: string[];
        };
        ProductDescriptionTemplate: {
            /** Format: uuid */
            id: string;
            name: string;
            /** @enum {string} */
            category: "company" | "logistics" | "packaging" | "service" | "custom";
            /** @enum {string} */
            language: "zh_CN" | "en_US";
            html: string;
            /** @enum {string} */
            status: "active" | "archived";
            createTimeUtc: number;
            updateTimeUtc: number;
            creatorId: string;
            updaterId: string;
            revision: number;
            remark: string | null;
        };
        ProductDescriptionTemplateCreateRequest: {
            requestId: components["schemas"]["RequestId"];
            name: string;
            /** @enum {string} */
            category: "company" | "logistics" | "packaging" | "service" | "custom";
            /** @enum {string} */
            language: "zh_CN" | "en_US";
            html: string;
            remark?: string | null;
        };
        ProductDescriptionTemplateListRequest: {
            requestId: components["schemas"]["RequestId"];
            /** @default 1 */
            page: number;
            /** @default 20 */
            pageSize: number;
            /** @enum {string} */
            language?: "zh_CN" | "en_US";
            /** @enum {string} */
            category?: "company" | "logistics" | "packaging" | "service" | "custom";
            /** @enum {string} */
            status?: "active" | "archived";
        };
        ProductDescriptionTemplatePage: {
            items: components["schemas"]["ProductDescriptionTemplate"][];
            page: number;
            pageSize: number;
            total: number;
        };
        ProductDescriptionTemplateStatusRequest: {
            requestId: components["schemas"]["RequestId"];
            /** Format: uuid */
            id: string;
            revision: number;
        };
        ProductDescriptionTemplateUpdateRequest: {
            requestId: components["schemas"]["RequestId"];
            /** Format: uuid */
            id: string;
            name: string;
            /** @enum {string} */
            category: "company" | "logistics" | "packaging" | "service" | "custom";
            /** @enum {string} */
            language: "zh_CN" | "en_US";
            html: string;
            revision: number;
            remark: string | null;
        };
        ProductDetail: components["schemas"]["Product"] & {
            categoryId: number;
            language: string;
            schemaXml: string;
        };
        ProductDisplayMutationResult: {
            encryptedProductIds: string[];
            /** @enum {string} */
            display: "online" | "offline";
            traceId: string;
            success: boolean;
        };
        ProductDisplayRequest: {
            encryptedProductIds: string[];
            /** @enum {string} */
            display: "online" | "offline";
        };
        ProductGroup: {
            id: number;
            name: string;
            children: components["schemas"]["ProductGroup"][];
        };
        ProductGroupCreateRequest: {
            name: string;
            parentId: number;
        };
        ProductMutationFieldExpectation: {
            fieldId: string;
            fingerprint: string;
        };
        ProductMutationJob: {
            /** Format: uuid */
            id: string;
            requestId: components["schemas"]["RequestId"];
            productId: string;
            /** @enum {string} */
            operation: "updateProduct";
            /** @enum {string} */
            status: "submitted" | "auditing" | "verified" | "recovery-required" | "failed";
            categoryId: number;
            /** @enum {string} */
            language: "zh_CN" | "en_US";
            payloadFingerprint: string;
            fieldExpectations: components["schemas"]["ProductMutationFieldExpectation"][];
            traceId: string | null;
            reasonCode: string | null;
            message: string | null;
            submittedTimeUtc: number;
            lastCheckedTimeUtc: number | null;
            completedTimeUtc: number | null;
            createTimeUtc: number;
            updateTimeUtc: number;
            creatorId: string;
            updaterId: string;
            revision: number;
            remark: string | null;
        };
        ProductMutationJobGetRequest: {
            requestId: components["schemas"]["RequestId"];
            /** Format: uuid */
            id: string;
        };
        ProductMutationJobListRequest: {
            requestId: components["schemas"]["RequestId"];
            /** @default 1 */
            page: number;
            /** @default 20 */
            pageSize: number;
            productId?: string;
            /** @enum {string} */
            status?: "submitted" | "auditing" | "verified" | "recovery-required" | "failed";
        };
        ProductMutationJobPage: {
            items: components["schemas"]["ProductMutationJob"][];
            page: number;
            pageSize: number;
            total: number;
        };
        ProductMutationJobRefreshRequest: {
            requestId: components["schemas"]["RequestId"];
            /** Format: uuid */
            id: string;
            revision: number;
        };
        ProductMutationResult: {
            productId: string;
            traceId: string;
            success: boolean;
            job?: components["schemas"]["ProductMutationJob"];
        };
        ProductPage: components["schemas"]["PageMeta"] & {
            items: components["schemas"]["Product"][];
        };
        ProductSchema: {
            xml: string;
            categoryId: number;
            language: string;
            market: string;
        };
        ProductSchemaRenderRequest: {
            categoryId: number;
            /** @default en_US */
            language: string;
            productId: string;
        };
        ProductSchemaRequest: {
            categoryId: number;
            /** @default en_US */
            language: string;
            /** @enum {string} */
            market: "wholesale" | "sourcing";
            productId?: string;
        };
        ProductSchemaUpdateRequest: {
            productId: string;
            categoryId: number;
            /** @enum {string} */
            language: "zh_CN" | "en_US";
            schemaPatchXml: string;
        };
        ProductScore: {
            productId: string;
            score: number;
            issues: string[];
            /** @description Optional normalized official issues when the upstream response provides structured details. */
            qualityIssues?: components["schemas"]["ProductDescriptionQualityIssue"][];
        };
        RequestEnvelope: {
            requestId: components["schemas"]["RequestId"];
        };
        /** Format: uuid */
        RequestId: string;
        RfqAttachment: {
            name: string;
            url: string;
        };
        RfqAttachmentUploadRequest: components["schemas"]["EncodedFilePayload"];
        RfqAttachmentUploadResult: {
            filesString: string;
        };
        RfqDetail: {
            id: string;
            subject: string;
            description: string;
            quantity: number | null;
            quantityUnit: string | null;
            countryCode: string | null;
            categoryId: number | null;
            categoryName: string | null;
            imageUrl: string | null;
            remainingQuotes: number | null;
            /** Format: date-time */
            openAt: string | null;
            /** Format: date-time */
            expiresAt: string | null;
            read: boolean;
            recommended: boolean;
            paymentTerms: string | null;
            destinationPort: string | null;
            shippingTerms: string | null;
            attachments: components["schemas"]["RfqAttachment"][];
        };
        RfqEquity: {
            remainingQuotes: number;
            remainingTopQuotes: number;
            score: number;
            beatSupplierPercent: string | null;
            expiresAt: string | null;
        };
        RfqPage: {
            items: components["schemas"]["RfqSummary"][];
            page: number;
            pageSize: number;
            total: number;
            /** @enum {string} */
            source: "search" | "recommend";
        };
        RfqQuotationPrice: {
            itemName: string;
            unitPrice: string;
            currency: string;
            quantity: string;
            quantityUnit: string;
            shippingTerms: string;
            port: string;
            remark: string;
            modelNumber?: string;
            imageFilesString?: string;
        };
        RfqQuotationRequest: {
            rfqId: string;
            message: string;
            paymentTerms: string;
            expiresAt: string;
            prices: components["schemas"]["RfqQuotationPrice"][];
            attachmentFilesString?: string;
        };
        RfqQuotationResult: {
            quotationId: string;
            success: boolean;
        };
        RfqReadStatus: {
            statuses: {
                [key: string]: boolean;
            };
        };
        RfqSummary: {
            id: string;
            subject: string;
            description: string;
            quantity: number | null;
            quantityUnit: string | null;
            countryCode: string | null;
            categoryId: number | null;
            categoryName: string | null;
            imageUrl: string | null;
            remainingQuotes: number | null;
            /** Format: date-time */
            openAt: string | null;
            /** Format: date-time */
            expiresAt: string | null;
            read: boolean;
            recommended: boolean;
        };
        SchemaPublishRequest: {
            categoryId: number;
            /** @default en_US */
            language: string;
            productId?: string;
            schemaXml: string;
        };
        ShippingTemplate: {
            id: string;
            name: string;
        };
        TradeAddress: {
            id: string;
            label: string;
            values: {
                [key: string]: string;
            };
        };
        TradeAddressSchema: {
            fields: components["schemas"]["TradeAddressSchemaField"][];
        };
        TradeAddressSchemaField: {
            id: string;
            label: string;
            /** @enum {string} */
            type: "text" | "select" | "textarea";
            required: boolean;
            readOnly: boolean;
            pattern?: string | null;
            maxLength?: number | null;
            options: {
                label: string;
                value: string;
            }[];
        };
        TradeFulfillmentChannel: {
            code: string;
            name: string;
            enabled: boolean;
            unavailableReason?: string | null;
        };
        TradeFund: {
            orderId: string;
            paidAmount: string;
            currency: string;
            status: string;
        };
        TradeLogistics: {
            orderId: string;
            status: string;
            carrier: string | null;
            trackingNumber: string | null;
        };
        TradeMutationResult: {
            id: string;
            success: boolean;
        };
        TradeOrderAggregate: {
            order: components["schemas"]["TradeOrderSummary"];
            fund: components["schemas"]["TradeFund"] | null;
            logistics: components["schemas"]["TradeLogistics"] | null;
            availability: {
                /** @enum {string} */
                order: "available" | "unavailable";
                /** @enum {string} */
                fund: "available" | "unavailable";
                /** @enum {string} */
                logistics: "available" | "unavailable";
                /** @enum {string} */
                fullDetail: "jushita-only";
            };
        };
        TradeOrderDraft: {
            orderId?: string;
            buyerLoginId: string;
            currency: string;
            addressId?: string;
            items: {
                productId: string;
                subject: string;
                quantity: string;
                unitPrice: string;
            }[];
        };
        TradeOrderPage: {
            items: components["schemas"]["TradeOrderSummary"][];
            page: number;
            pageSize: number;
            total: number;
            documentTimeZoneUnverified: boolean;
        };
        TradeOrderSummary: {
            id: string;
            buyerLoginId: string | null;
            status: string;
            amount: string;
            currency: string;
            /** Format: date-time */
            createdAt: string | null;
            /** Format: date-time */
            modifiedAt: string | null;
        };
        TradeServiceCharge: {
            currency: string;
            items: components["schemas"]["TradeServiceChargeItem"][];
        };
        TradeServiceChargeItem: {
            ratio: string | null;
            maxFee: string | null;
            exportServiceType: string | null;
            logisticsType: string | null;
        };
        TradeTtAccount: {
            orderId: string;
            payableAmount: string;
            currency: string;
            accountName: string | null;
            accountNumber: string | null;
            bankName: string | null;
            guideContent: string | null;
        };
        /** @enum {string} */
        UserRole: "admin" | "user";
        /** @enum {string} */
        UserStatus: "active" | "disabled";
    };
    responses: {
        /** @description Gateway failure */
        GatewayFailure: {
            headers: {
                "X-Request-ID"?: components["schemas"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
            };
        };
    };
    parameters: {
        Page: number;
        PageSize: number;
        ProductId: string;
        OrderId: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    healthCheck: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Process is alive */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProbeResponse"];
                };
            };
        };
    };
    readinessCheck: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Application is ready */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProbeResponse"];
                };
            };
            /** @description Application is not ready */
            503: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
    getBackendMeta: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequestEnvelope"];
            };
        };
        responses: {
            /** @description Backend metadata */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
    callOperation: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OperationCallRequest"];
            };
        };
        responses: {
            /** @description Operation result */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Operation denied */
            403: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Backend unavailable */
            503: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
    listProductMutationJobs: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProductMutationJobListRequest"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            400: components["responses"]["GatewayFailure"];
            401: components["responses"]["GatewayFailure"];
        };
    };
    getProductMutationJob: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProductMutationJobGetRequest"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            400: components["responses"]["GatewayFailure"];
            401: components["responses"]["GatewayFailure"];
            404: components["responses"]["GatewayFailure"];
        };
    };
    refreshProductMutationJob: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProductMutationJobRefreshRequest"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            400: components["responses"]["GatewayFailure"];
            401: components["responses"]["GatewayFailure"];
            404: components["responses"]["GatewayFailure"];
            409: components["responses"]["GatewayFailure"];
        };
    };
    getAuthSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequestEnvelope"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Operation denied */
            403: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Entity conflict */
            409: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
    bootstrapAdmin: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AuthBootstrapRequest"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Operation denied */
            403: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Entity conflict */
            409: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AuthLoginRequest"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Operation denied */
            403: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Entity conflict */
            409: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequestEnvelope"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Operation denied */
            403: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Entity conflict */
            409: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
    changePassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AuthPasswordChangeRequest"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Operation denied */
            403: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Entity conflict */
            409: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
    listAdminUsers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PageRequest"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Operation denied */
            403: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Entity conflict */
            409: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
    createAdminUser: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminUserCreateRequest"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Operation denied */
            403: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Entity conflict */
            409: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
    updateAdminUser: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminUserUpdateRequest"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Operation denied */
            403: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Entity conflict */
            409: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
    resetAdminUserPassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminPasswordResetRequest"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Operation denied */
            403: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Entity conflict */
            409: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
    revokeAdminUserSessions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminUserTargetRequest"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Operation denied */
            403: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Entity conflict */
            409: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
    listAdminAuditEvents: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminAuditListRequest"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Operation denied */
            403: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Entity conflict */
            409: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
    getAdminSystem: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequestEnvelope"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Operation denied */
            403: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Entity conflict */
            409: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
    getAdminPolicySummary: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequestEnvelope"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Operation denied */
            403: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Entity conflict */
            409: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
    listAdminRequestEvents: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminRequestEventListRequest"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Operation denied */
            403: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Entity conflict */
            409: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
    purgeAdminRequestEvents: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequestEnvelope"];
            };
        };
        responses: {
            /** @description Operation succeeded */
            200: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Operation denied */
            403: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
            /** @description Entity conflict */
            409: {
                headers: {
                    "X-Request-ID"?: components["schemas"]["RequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiSuccess"] | components["schemas"]["ApiFailure"];
                };
            };
        };
    };
}
