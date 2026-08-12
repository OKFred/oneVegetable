export interface paths {
    "/dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get dashboard summary */
        get: operations["getDashboard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List products */
        get: operations["listProducts"];
        put?: never;
        /** Publish a product with Schema XML */
        post: operations["publishProduct"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/products/drafts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Save a product draft with Schema XML */
        post: operations["saveProductDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/products/schema": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Get the product publishing Schema */
        post: operations["getProductSchema"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/products/display": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update product display state */
        patch: operations["updateProductDisplay"];
        trace?: never;
    };
    "/products/{productId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                productId: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        /** Get a product rendered as Schema XML */
        get: operations["getProduct"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update a product with Schema XML */
        patch: operations["updateProduct"];
        trace?: never;
    };
    "/photo-groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List photo bank groups */
        get: operations["listPhotoGroups"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/photos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List photo bank images */
        get: operations["listPhotos"];
        put?: never;
        /** Upload a photo bank image */
        post: operations["uploadPhoto"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List seller orders */
        get: operations["listOrders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/fund": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get order fund information */
        get: operations["getOrderFund"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/logistics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get order logistics information */
        get: operations["getOrderLogistics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List audited API capabilities */
        get: operations["listCapabilities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/gateway/call": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Call an enabled audited capability */
        post: operations["callCapability"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/capabilities/{method}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a typed capability definition */
        get: operations["getCapabilityDefinition"];
        put?: never;
        post?: never;
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
        DashboardSummary: {
            productCount: number;
            photoCount: number;
            pendingOrderCount: number;
            enabledCapabilityCount: number;
        };
        Product: {
            id: string;
            subject: string;
            groupName: string;
            /** @enum {string} */
            status: "online" | "offline" | "draft" | "auditing" | "rejected";
            score: number;
            /** Format: date-time */
            updatedAt: string;
        };
        ProductDetail: components["schemas"]["Product"] & {
            categoryId: number;
            language: string;
            schemaXml: string;
        };
        ProductPage: components["schemas"]["PageMeta"] & {
            items: components["schemas"]["Product"][];
        };
        ProductSchemaRequest: {
            categoryId: number;
            /** @default en_US */
            language: string;
            /** @enum {string} */
            market: "wholesale" | "sourcing";
            productId?: string;
        };
        ProductSchema: {
            xml: string;
            categoryId: number;
            language: string;
            market: string;
        };
        SchemaPublishRequest: {
            categoryId: number;
            /** @default en_US */
            language: string;
            productId?: string;
            schemaXml: string;
        };
        ProductMutationResult: {
            productId: string;
            traceId: string;
            success: boolean;
        };
        PhotoGroup: {
            id: string;
            name: string;
            photoCount: number;
        };
        Photo: {
            id: string;
            name: string;
            /** Format: uri */
            url: string;
            groupId: string;
            width: number;
            height: number;
        };
        PhotoPage: components["schemas"]["PageMeta"] & {
            items: components["schemas"]["Photo"][];
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
        OrderPage: components["schemas"]["PageMeta"] & {
            items: components["schemas"]["Order"][];
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
        CapabilityCallRequest: {
            method: string;
            parameters: components["schemas"]["AlibabaProductAlibabaIcbuCategoryAttrGetRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryAttributeGetRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryAttrvalueGetRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryGetRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryGetNewRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryIdMappingRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryLevelAttrGetRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryPostcatGetRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuCategorySchemaLevelGetRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuOpenProductPostRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuProductAddRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuProductAddDraftRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuProductBatchUpdateDisplayRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuProductGetRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuProductGroupAddRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuProductGroupGetRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuProductIdDecryptRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuProductListRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaAddRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaAddDraftRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaGetRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaRenderRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaRenderDraftRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaUpdateRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuProductScoreGetRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuProductUpdateRequest"] | components["schemas"]["AlibabaProductAlibabaIcbuProductUpdateFieldRequest"];
        };
        CapabilityCallResult: components["schemas"]["CapabilityResponseEnvelope"];
        GatewayError: {
            code: string;
            message: string;
            subCode?: string;
            traceId?: string;
            retryable: boolean;
        };
        PageMeta: {
            page: number;
            pageSize: number;
            total: number;
        };
        CapabilityContractIssue: {
            instancePath: string;
            keyword: string;
            message: string;
        };
        CapabilityResponseEnvelope: {
            method: string;
            traceId: string;
            data: components["schemas"]["AlibabaProductAlibabaIcbuCategoryAttrGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryAttributeGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryAttrvalueGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryGetNewResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryIdMappingResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryLevelAttrGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuCategoryPostcatGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuCategorySchemaLevelGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuOpenProductPostResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductAddResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductAddDraftResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductBatchUpdateDisplayResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductGroupAddResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductGroupGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductIdDecryptResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductListResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaAddResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaAddDraftResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaRenderResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaRenderDraftResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductSchemaUpdateResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductScoreGetResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductUpdateResponse"] | components["schemas"]["AlibabaProductAlibabaIcbuProductUpdateFieldResponse"];
            contractValid: boolean;
            contractIssues: components["schemas"]["CapabilityContractIssue"][];
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
                child_ids?: string[];
                /** @description 是否叶子类目（只有叶子类目才能发布商品） */
                leaf_category?: boolean;
                /** @description 类目层级 */
                level?: number;
                /** @description 类目名称 */
                name?: string;
                /** @description 父类目ID数组 */
                parent_ids?: string[];
                /** @description 类目的中文名 */
                cn_name?: string;
            };
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
        };
        /** alibaba.icbu.product.schema.render request */
        AlibabaProductAlibabaIcbuProductSchemaRenderRequest: {
            /** @description 商品规则渲染请求 */
            param_product_top_publish_request?: {
                /** @description 类目id */
                cat_id?: number;
                /** @description 返回文案的语种，支持en_US,zh,zh_TW */
                language?: string;
                /** @description 商品明文id */
                product_id?: number;
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
        };
        /** alibaba.icbu.product.schema.render.draft request */
        AlibabaProductAlibabaIcbuProductSchemaRenderDraftRequest: {
            /** @description 商品规则渲染请求 */
            param_product_top_publish_request?: {
                /** @description 类目id */
                cat_id?: number;
                /** @description 返回文案的语种，支持en_US,zh,zh_TW */
                language?: string;
                /** @description 草稿商品明文id */
                product_id?: number;
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
        };
    };
    responses: {
        /** @description Gateway failure */
        GatewayFailure: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["GatewayError"];
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
    getDashboard: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Dashboard summary */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DashboardSummary"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    listProducts: {
        parameters: {
            query?: {
                page?: components["parameters"]["Page"];
                pageSize?: components["parameters"]["PageSize"];
                subject?: string;
                groupId?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Product page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductPage"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    publishProduct: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SchemaPublishRequest"];
            };
        };
        responses: {
            /** @description Published product */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductMutationResult"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    saveProductDraft: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SchemaPublishRequest"];
            };
        };
        responses: {
            /** @description Saved draft */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductMutationResult"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    getProductSchema: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProductSchemaRequest"];
            };
        };
        responses: {
            /** @description Alibaba schema XML and normalized fields */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductSchema"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    updateProductDisplay: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    productIds: string[];
                    /** @enum {string} */
                    display: "online" | "offline";
                };
            };
        };
        responses: {
            /** @description Updated */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    getProduct: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                productId: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Product detail */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductDetail"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    updateProduct: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                productId: components["parameters"]["ProductId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SchemaPublishRequest"];
            };
        };
        responses: {
            /** @description Updated product */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductMutationResult"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    listPhotoGroups: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Photo groups */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PhotoGroup"][];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    listPhotos: {
        parameters: {
            query?: {
                page?: components["parameters"]["Page"];
                pageSize?: components["parameters"]["PageSize"];
                groupId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Photo page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PhotoPage"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    uploadPhoto: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    file: string;
                    fileName: string;
                    /** @default -1 */
                    groupId?: string;
                };
            };
        };
        responses: {
            /** @description Uploaded photo */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Photo"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    listOrders: {
        parameters: {
            query?: {
                page?: components["parameters"]["Page"];
                pageSize?: components["parameters"]["PageSize"];
                status?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Order page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderPage"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    getOrderFund: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Order fund information */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderFund"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    getOrderLogistics: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Order logistics information */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderLogistics"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    listCapabilities: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Audited Alibaba API capabilities */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiCapability"][];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    callCapability: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CapabilityCallRequest"];
            };
        };
        responses: {
            /** @description Normalized gateway result */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CapabilityCallResult"];
                };
            };
            default: components["responses"]["GatewayFailure"];
            "4XX": components["responses"]["GatewayFailure"];
        };
    };
    getCapabilityDefinition: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                method: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Capability definition */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CapabilityDefinition"];
                };
            };
            "4XX": components["responses"]["GatewayFailure"];
            default: components["responses"]["GatewayFailure"];
        };
    };
}
