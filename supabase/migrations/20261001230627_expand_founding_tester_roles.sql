alter table public.waitlist_signups
  drop constraint if exists waitlist_signups_user_type_check;

alter table public.waitlist_signups
  add constraint waitlist_signups_user_type_check
  check (user_type in (
    'car_owner',
    'van_life',
    'used_car_buyer',
    'weekend_wrencher',
    'mechanic',
    'mechanic_student',
    'parts_seller',
    'salvage_yard',
    'marketplace_seller',
    'shop_advisor',
    'other'
  ));

notify pgrst, 'reload schema';
