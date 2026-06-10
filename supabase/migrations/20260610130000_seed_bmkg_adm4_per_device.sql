-- ADM4 BMKG per titik pantau (Bojong Kulur deployment)

UPDATE sijagaair.device_configs
SET bmkg_adm4 = '32.01.32.2003'
WHERE deployment_slug = 'sijagaair-bojong-kulur' AND device_id = 'node-001';

UPDATE sijagaair.device_configs
SET bmkg_adm4 = '32.01.02.2009'
WHERE deployment_slug = 'sijagaair-bojong-kulur' AND device_id = 'node-002';

UPDATE sijagaair.device_configs
SET bmkg_adm4 = '32.01.02.2002'
WHERE deployment_slug = 'sijagaair-bojong-kulur' AND device_id = 'node-003';
