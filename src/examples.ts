export interface Example {
  id: string;
  label: string;
  urls: readonly string[];
}

export const EXAMPLES: readonly Example[] = [
  {
    id: "shop",
    label: "Shop search: keys, lists, base64, JWT, Rison",
    urls: [
      "https://shop.example.com/catalog;view=grid/shoes?q=trail+runner&filter[size][]=9&filter[size][]=10&filter[brand]=acme&sort=price,-rating&ui.theme=dark&ui.density=compact&ctx=eyJ1c2VyIjo0MiwiZXhwZXJpbWVudHMiOlsibmV3LW5hdiJdfQ&token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0MiIsInNjb3BlIjoicmVhZCIsImV4cCI6MTc5MzAwMDAwMH0.c2lnbmF0dXJlLWE&return=https%3A%2F%2Fshop.example.com%2Fcart%3Fstep%3D2%26coupon%3DFALL&_g=(time:(from:now-7d,to:now))#/reviews?page=1",
      "https://shop.example.com/catalog;view=list/shoes?q=trail+runners&filter[size][]=9&filter[size][]=11&filter[brand]=acme&filter[color]=red&sort=price,-rating&ui.theme=light&ui.density=compact&ctx=eyJ1c2VyIjo0MiwiZXhwZXJpbWVudHMiOlsibmV3LW5hdiIsImZhc3QtY2hlY2tvdXQiXX0&token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0MiIsInNjb3BlIjoicmVhZCB3cml0ZSIsImV4cCI6MTc5MzA4NjQwMH0.c2lnbmF0dXJlLWI&return=https%3A%2F%2Fshop.example.com%2Fcart%3Fstep%3D3%26coupon%3DFALL&_g=(time:(from:now-30d,to:now))#/reviews?page=2",
    ],
  },
  {
    id: "oauth",
    label: "OAuth sign-in: scopes, double encoding",
    urls: [
      "https://accounts.example.com/o/oauth2/v2/auth?response_type=code&client_id=web-app.apps.example.com&scope=openid%20profile%20email&redirect_uri=https%3A%2F%2Fapp.example.com%2Fauth%2Fcallback&state=eyJyZXR1cm5UbyI6Ii9kYXNoYm9hcmQiLCJub25jZSI6Im4tMFM2X1d6QTJNaiJ9&code_challenge=rjcJ0X8zmymqeElueLwUgtk87dwMWXc7Qg-MJFl7C3w&code_challenge_method=S256&prompt=consent&ui_locales=en-AU%20en&continue=https%253A%252F%252Fapp.example.com%252Fhome%253Ftab%253Dbilling",
      "https://accounts.example.com/o/oauth2/v2/auth?response_type=code&client_id=web-app.apps.example.com&scope=openid%20email%20profile%20offline_access&redirect_uri=https%3A%2F%2Fapp.example.com%2Fauth%2Fcallback%2Fv2&state=eyJyZXR1cm5UbyI6Ii9zZXR0aW5ncyIsIm5vbmNlIjoibi05S3FfTHIzVGY4In0&code_challenge=IM1myAhY7k0CPupCDT7yUcHwIAmYctca0Pb87WdKuWQ&code_challenge_method=S256&prompt=select_account&ui_locales=en-AU%20en&continue=https%253A%252F%252Fapp.example.com%252Fhome%253Ftab%253Dusage",
    ],
  },
  {
    id: "saml",
    label: "SAML sign-in: compressed XML",
    urls: [
      "https://idp.example.com/saml2/sso?SAMLRequest=fZLdTsJAEIVfZbP39A8osKEkFWJsgkqgeuGNGbdT2aS7W3e2im9vKBo1Ru4mM%2BdkzpeZOYFuWpF3fm%2B2%2BNIheXbQjSHRDzLeOSMskCJhQCMJL8Uuv16LJIhE66y30jb8h%2BW8A4jQeWUNZ8Uq449TnFZyXKczmE2lHMm4roejZIJjicNRGqV1lU6SehZjytk9OlLWZDwJIs4Kog4LQx6Mz3gSJekgjgdRWkYzESdiGD1wtkLyyoDvXXvvWxJhqKo2wAPotsFAWh0eQychkeVs88lzoUylzPN5lKeTiMRVWW4Gm9tdyVn%2Bhbe0hjqNbofuVUm8266%2FA0D7N0AIkvhifixFT%2BYWZ%2BUaPVTgYR7%2BtMxPx7wBjcVqYxsl39mldRr8%2FyhxEPcdVQ3qXipQg2ryqnJIxFneNPZt6RA8Zty7Dnm4OG39%2FTWLDw%3D%3D&RelayState=https%3A%2F%2Fapp.example.com%2Freports&SigAlg=http%3A%2F%2Fwww.w3.org%2F2001%2F04%2Fxmldsig-more%23rsa-sha256&Signature=yFSNuRvH3hIMSNtYa4xpnsxY5btAwFnJlEiGW5qXQV3yhmPfFhTKq%2BqViX8HJLZQggmLdOq%2Fwe%2FOvByi%2Bbo8uA%3D%3D",
      "https://idp.example.com/saml2/sso?SAMLRequest=fZJvT8IwEIe%2FStP3sDHGnzWMBCFGElQC6AvfmLO7SZO1nb0b6rc3DI0YE172ek%2F6e643IbBVrWYN790G3xokFh%2B2cqTai1w2wSkPZEg5sEiKtdrOblcq6caqDp699pU8Qy4TQISBjXdSLBe5fC5GPejDGLNS63SgM8yKJB1jOYrTrJ%2F1Sz0u4xQH5WggxSMGMt7lMunGUiyJGlw6YnCcyyROhp1erxMPd3GmeqmKkycpFkhsHHBL7ZlrUlFkirqLH2DrCrva2%2BgYOomIvBTrb58r4wrjXi%2BrvJyaSN3sduvO%2Bn67k2L2ozf3jhqLYYvhYDQ%2BbFa%2FAaD%2BHyACTdEhkdPJ8aRauTC9SFhkKIBhEp0jk9N%2F3oHF5WLtK6M%2FxbUPFviyzbFiik7Ztqr6OGpidCzFrKr8%2BzwgMOaSQ4Mymp7e%2FLs20y8%3D&RelayState=https%3A%2F%2Fapp.example.com%2Freports%3Frange%3D90d&SigAlg=http%3A%2F%2Fwww.w3.org%2F2001%2F04%2Fxmldsig-more%23rsa-sha256&Signature=8XAWAPhDsJbb7x2PGpstBsTAPdww%2FgQWuiCjsQef%2FU9PiqO49GNDc8%2FNYH%2BZVFZkHukE9bzxvWlPE6fzqUgwrw%3D%3D",
    ],
  },
  {
    id: "aws",
    label: "Signed S3 download URLs",
    urls: [
      "https://example-bucket.s3.ap-southeast-2.amazonaws.com/reports/2026/q3.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20261106%2Fap-southeast-2%2Fs3%2Faws4_request&X-Amz-Date=20261106T091230Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&response-content-disposition=attachment%3B%20filename%3D%22q3.pdf%22&X-Amz-Signature=60c20f944485c8aef64791d86c10dbff269425cd1f90b1f9f8f9276ea5348b7a",
      "https://example-bucket.s3.ap-southeast-2.amazonaws.com/reports/2026/q4.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20261106%2Fap-southeast-2%2Fs3%2Faws4_request&X-Amz-Date=20261106T101500Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host%3Bx-amz-content-sha256&response-content-disposition=attachment%3B%20filename%3D%22q4.pdf%22&X-Amz-Signature=093da7ba03b9f8467c8f02f699833f68d5400cdd02f5b99d21f4789473ea3285",
    ],
  },
  {
    id: "maps",
    label: "Google Maps places",
    urls: [
      "https://www.google.com/maps/place/Sydney+Opera+House/@-33.8567844,151.2152967,17z/data=!3m1!4b1!4m6!3m5!1s0x6b12ae665e892fdd:0x3133f8d75a1ac251!8m2!3d-33.8567844!4d151.2152967!16zL20vMDZfbnI?entry=ttu",
      "https://www.google.com/maps/place/Sydney+Harbour+Bridge/@-33.8523063,151.2107871,16z/data=!3m1!4b1!4m6!3m5!1s0x6b12ae5d7cbef2b5:0x9f9b84c4fe1c4d5b!8m2!3d-33.8523063!4d151.2107871!16zL20vMDdibmo?entry=ttu",
    ],
  },
  {
    id: "intent",
    label: "Android intent links",
    urls: [
      "intent://scan/#Intent;scheme=zxing;package=com.google.zxing.client.android;action=android.intent.action.VIEW;S.browser_fallback_url=https%3A%2F%2Fexample.com%2Fapp%3Fref%3Dqr;i.version=3;B.debug=false;end",
      "intent://scan/#Intent;scheme=zxing;package=com.google.zxing.client.android.beta;action=android.intent.action.VIEW;S.browser_fallback_url=https%3A%2F%2Fexample.com%2Fapp%3Fref%3Demail;i.version=4;B.debug=true;l.since=1793000000000;end",
    ],
  },
  {
    id: "ts",
    label: "TypeScript playground (lz-string)",
    urls: [
      "https://www.typescriptlang.org/play/?target=99&strict=false#code/MYewdgzgLgBA5gJwKZNgXhgCjAQwLZIBcM0CAlmHAJQxoB8MABgBJIA2bIANDACQDeuAgF9GAbgBQoSCDZIAdJziZEKKJgBEAdxAI2AEw1UqkoA",
      "https://www.typescriptlang.org/play/?target=9&strict=true#code/MYewdgzgLgBA5gJwKZNgXhgCjAQwLZIBcM0CAlmHADQwAOArmMFPTlGeDBgEQCE3ASi4A+GAAMAEkgA20kDQAkAb1wEAvsoZMWbDmDViA3AChQkENKQA6OXEyIUUTNwDuIBNIAmggSaA",
    ],
  },
  {
    id: "mermaid",
    label: "Mermaid editor (pako)",
    urls: [
      "https://mermaid.live/edit#pako:eJwlyrEKgzAURuFXCf_Ugr5AhoKapVuh3ZIMt-ZWBRMlvRmK-O7FdjwfZ0O_BIbGkGkd1cO4pFRju3niJF7V9UW1trld_eHtrzt7MiT0pDefPSpEzpGmAI3tmBxk5MgOWjkEflGZxcGlHRWoyHL_pB5acuEKZQ0kbCYaMsU_7l_hTy74",
      "https://mermaid.live/edit#pako:eJxNyrEOgjAURuFXaf5JE3iBDiZAFzcT3Xo7XOkNEG0htR0M4d0NujieL2dFP3uBxpB4GdXNUFSqsd1zkpidquuTam1zObvd228b23E_yp909mA4851fcnSoECQFnjw01n0i5FGCELQieE4PAsUNFbjk-fqOPXRORSqUxXMWM_GQOPxw-wBTijKp",
    ],
  },
  {
    id: "tokens",
    label: "Signed tokens, IDs and search syntax",
    urls: [
      "https://app.example.com/report?session=eyJ1c2VyX2lkIjo0Miwicm9sZSI6InZpZXdlciJ9.at8CQA.2AiCRUfCIxgCsqFtTZWTrM33o2c&remember=eyJfcmFpbHMiOnsibWVzc2FnZSI6ImV5SjFjMlZ5WDJsa0lqbzBNaXdpWkdWMmFXTmxJam9pYkdGd2RHOXdJbjA9IiwiZXhwIjpudWxsLCJwdXIiOiJjb29raWUucmVtZW1iZXIifX0%3D--8d97010b08f57de40d04fb19ea1fe5a15e38b7ad&ticket=v4.public.eyJzdWIiOiI0MiIsInNjb3BlIjoicmVhZCIsImV4cCI6IjIwMjYtMTItMDFUMDA6MDA6MDArMDA6MDAifXWJxTuRSb9DuIxl-qJ8KNvf9ztzXSQibCRNnj-vl_fURejYbVi1YD6P5gS3m1SAHDchWp72RTpnMsVeX-GURZA&request=01a17720-ca00-7d35-8388-f8885213ec40&order=01M5VJ1JG08QYHDJQ7VEMNEAK7&post=2114621382456250367&view=~(cols~(~'name~'owner)~sort~'name)&q=is%3Aopen+label%3A%22bug+fix%22+crash&ved=0CCoSA2FiYxoCCAc&ts=1793000000#overview:~:text=quarterly-,revenue,growth",
      "https://app.example.com/report?session=eyJ1c2VyX2lkIjo0Miwicm9sZSI6ImFkbWluIn0.auBTwA.Z0IOO0b4hP-x_kVC6yHYg1i80L8&remember=eyJfcmFpbHMiOnsibWVzc2FnZSI6ImV5SjFjMlZ5WDJsa0lqbzBNaXdpWkdWMmFXTmxJam9pY0dodmJtVWlmUT09IiwiZXhwIjpudWxsLCJwdXIiOiJjb29raWUucmVtZW1iZXIifX0%3D--0f7bfd18b5ad6ee94907862968f9b47791484516&ticket=v4.public.eyJzdWIiOiI0MiIsInNjb3BlIjoicmVhZCB3cml0ZSIsImV4cCI6IjIwMjYtMTItMDFUMDA6MDA6MDArMDA6MDAifTA-FXN_vPPiuAqkOkxzXGCHQhAT5mzn6fKIrIrlX5TyR1n7gPai3SJJX-F24k5ubXRrWjrRe54HZ8wYppDL7ao&request=01a17c47-2600-78c6-8b77-66cf93f0fcbc&order=01M5Y4E9G07D4BDPAX04JS8MX1&post=2114983770321850367&view=~(cols~(~'name~'owner~'updated)~sort~'-updated)&q=is%3Aclosed+label%3A%22bug+fix%22+author%3Asam+crash&ved=0CCsSA2FiYxoCCAc&ts=1793086400#overview:~:text=quarterly-,revenue,decline",
    ],
  },
  {
    id: "curl",
    label: "curl commands",
    urls: [
      "curl 'https://api.example.com/v2/orders?status=open&limit=50' \\\n  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0MiIsInNjb3BlIjoib3JkZXJzOnJlYWQiLCJleHAiOjE3OTMwMDAwMDB9.ajSqsRtwC4-oozRbXnWFNDHegA3fu5tkTd1E3Cl44EI' \\\n  -H 'Accept: application/json' \\\n  -H 'Cookie: session=abc123; theme=dark' \\\n  --compressed",
      "curl -X POST 'https://api.example.com/v2/orders' \\\n  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0MiIsInNjb3BlIjoib3JkZXJzOndyaXRlIiwiZXhwIjoxNzkzMDAzNjAwfQ.WHCldAkgN8iBjhG-eYtSVz-m-0gHOqdCYdM96h1nlrs' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Cookie: session=abc123; theme=light' \\\n  --data-raw '{\"sku\":\"TR-9\",\"qty\":2,\"gift\":false}' \\\n  --compressed -sS",
    ],
  },
];

export const EXAMPLE = EXAMPLES[0]!.urls;
