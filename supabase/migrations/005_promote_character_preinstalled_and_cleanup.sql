-- Promote one existing character to preinstalled and remove legacy seeded characters.
-- Also normalize media URLs to stable local paths so preview/editor always loads images.

update public.library_assets
set
  source = 'preinstalled',
  workspace_id = null,
  owner_id = null,
  s3_key = null,
  file_url = '/preinstalled/characters/doctor-e0ea2c0e/base.png',
  thumbnail_url = '/preinstalled/characters/doctor-e0ea2c0e/base.png',
  mime_type = 'image/png',
  metadata_json = jsonb_build_object(
    'emotions_count', 4,
    'emotionImages', jsonb_build_object(
      'neutral', '/preinstalled/characters/doctor-e0ea2c0e/emotions/neutral.png',
      'happy', '/preinstalled/characters/doctor-e0ea2c0e/emotions/happy.png',
      'concerned', '/preinstalled/characters/doctor-e0ea2c0e/emotions/neutral.png',
      'angry', '/preinstalled/characters/doctor-e0ea2c0e/emotions/angry.png'
    )
  ),
  updated_at = timezone('utc', now())
where id = 'e0ea2c0e-ea03-4534-b51b-09f014fe3b53'
  and type = 'character';

delete from public.library_assets
where id in (
  '4fc1896a-8e77-4f89-87b7-9fb8dd420001',
  '4fc1896a-8e77-4f89-87b7-9fb8dd420002',
  '4fc1896a-8e77-4f89-87b7-9fb8dd420003'
);
