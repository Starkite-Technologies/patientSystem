from django.core.management.commands.runserver import Command as DjangoRunserver


class Command(DjangoRunserver):
    def check_migrations(self):
        # This API has no ORM-managed database. Supabase SQL owns the schema.
        pass
